import type { OpsAuthContext, OpsJobType } from '@/lib/ops-adapter/types';
import { appendJobLog, finalizeOpsJob, requireOpsPlan, updateOpsJob, getOpsJobStore } from '@/lib/ops-adapter/store';
import { writeAuditLog } from '@/lib/ops-adapter/audit';
import { executeAutonomousOperation, rollbackAutonomousOperation } from '@/lib/autonomous/service';
import { runOpsVerify } from '@/lib/ops-adapter/verify';

export type OpsJobPayloadExecute = { planId: string; requestId: string; dryRun: boolean };
export type OpsJobPayloadVerify = { planId: string; requestId: string };
export type OpsJobPayloadRollback = {
  requestId: string;
  dryRun: boolean;
  operationId: string;
  sourceJobId?: string;
};

export type OpsJobPayload = OpsJobPayloadExecute | OpsJobPayloadVerify | OpsJobPayloadRollback;

type QueueItem = {
  jobId: string;
  type: OpsJobType;
  actor: OpsAuthContext;
  requestId?: string;
  payload: OpsJobPayload;
  enqueuedAt: string;
};

const globalForOpsWorker = globalThis as unknown as {
  __sentinai_ops_job_queue?: QueueItem[];
  __sentinai_ops_job_worker_running?: boolean;
};

function getQueue(): QueueItem[] {
  if (!globalForOpsWorker.__sentinai_ops_job_queue) {
    globalForOpsWorker.__sentinai_ops_job_queue = [];
  }
  return globalForOpsWorker.__sentinai_ops_job_queue;
}

function isWorkerRunning(): boolean {
  return globalForOpsWorker.__sentinai_ops_job_worker_running === true;
}

function setWorkerRunning(value: boolean) {
  globalForOpsWorker.__sentinai_ops_job_worker_running = value;
}

function jobTimeoutMs(): number {
  const raw = Number(process.env.SENTINAI_OPS_JOB_TIMEOUT_MS || '60000');
  return Number.isFinite(raw) && raw > 0 ? raw : 60000;
}

function allowLiveExecution(): boolean {
  return process.env.SENTINAI_ADAPTER_ALLOW_LIVE_EXECUTION === 'true';
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

export function enqueueOpsJob(item: Omit<QueueItem, 'enqueuedAt'>): void {
  const queue = getQueue();
  queue.push({ ...item, enqueuedAt: new Date().toISOString() });

  // Best-effort: if the process survives, start worker loop.
  // NOTE: In serverless environments this may not run; for demo we assume Node runtime.
  if (!isWorkerRunning()) {
    void startWorkerLoop();
  }
}

async function startWorkerLoop(): Promise<void> {
  if (isWorkerRunning()) return;
  setWorkerRunning(true);

  try {
    for (;;) {
      const next = getQueue().shift();
      if (!next) break;
      await processQueueItem(next);
    }
  } finally {
    setWorkerRunning(false);
  }
}

async function processQueueItem(item: QueueItem): Promise<void> {
  const { jobId, type, actor, requestId } = item;

  // If job was deleted externally, just skip.
  if (!getOpsJobStore().has(jobId)) return;

  updateOpsJob(jobId, { status: 'running', progress: 5 });
  appendJobLog(jobId, `Worker started type=${type}`);

  await writeAuditLog({
    at: new Date().toISOString(),
    actor,
    action: `ops.job.${type}.started`,
    requestId,
    metadata: { jobId },
  });

  try {
    if (type === 'execute') {
      const payload = item.payload as OpsJobPayloadExecute;
      const plan = requireOpsPlan(payload.planId);

      if (!payload.dryRun) {
        // safety rail: must be explicitly enabled
        if (!allowLiveExecution()) {
          throw new Error('Live execution is disabled (set SENTINAI_ADAPTER_ALLOW_LIVE_EXECUTION=true)');
        }
        if (actor.role !== 'admin') {
          throw new Error('Forbidden: admin role required for live execution');
        }
      }

      appendJobLog(jobId, `Executing planId=${payload.planId} dryRun=${payload.dryRun}`);
      updateOpsJob(jobId, { progress: 15 });

      const result = await withTimeout(
        executeAutonomousOperation({
          planId: undefined,
          intent: plan.intent as any,
          context: {
            dryRun: payload.dryRun,
            allowWrites: !payload.dryRun && actor.role === 'admin',
            metadata: {
              target: plan.target,
              parameters: plan.parameters,
              requestId: payload.requestId,
              planId: payload.planId,
            },
          },
        }),
        jobTimeoutMs(),
        `execute jobId=${jobId}`,
      );

      updateOpsJob(jobId, {
        progress: 90,
        operationId: result.operationId,
        result: { operationId: result.operationId, success: result.success, steps: result.steps },
      });
      appendJobLog(jobId, `OperationId=${result.operationId} success=${result.success}`);

      finalizeOpsJob(jobId, result.success ? 'succeeded' : 'failed', result.success ? 'completed' : 'failed');

      await writeAuditLog({
        at: new Date().toISOString(),
        actor,
        action: 'ops.execute.completed',
        requestId: payload.requestId,
        metadata: { jobId, planId: payload.planId, operationId: result.operationId, success: result.success, dryRun: payload.dryRun },
      });

      return;
    }

    if (type === 'rollback') {
      const payload = item.payload as OpsJobPayloadRollback;
      if (!payload.dryRun) {
        if (!allowLiveExecution()) {
          throw new Error('Live rollback is disabled (set SENTINAI_ADAPTER_ALLOW_LIVE_EXECUTION=true)');
        }
        if (actor.role !== 'admin') {
          throw new Error('Forbidden: admin role required for live rollback');
        }
      }

      appendJobLog(jobId, `Rollback operationId=${payload.operationId} dryRun=${payload.dryRun}`);
      updateOpsJob(jobId, { progress: 20, operationId: payload.operationId });

      const result = await withTimeout(
        rollbackAutonomousOperation({
          operationId: payload.operationId,
          dryRun: payload.dryRun,
          allowWrites: !payload.dryRun && actor.role === 'admin',
          reason: 'ops.rollback.request',
        }),
        jobTimeoutMs(),
        `rollback jobId=${jobId}`,
      );

      updateOpsJob(jobId, { progress: 90, result });
      appendJobLog(jobId, `Rollback success=${result.success} steps=${result.rollbackSteps.length}`);

      finalizeOpsJob(jobId, result.success ? 'succeeded' : 'failed', result.success ? 'rollback completed' : 'rollback failed');

      await writeAuditLog({
        at: new Date().toISOString(),
        actor,
        action: 'ops.rollback.completed',
        requestId: payload.requestId,
        metadata: { jobId, operationId: payload.operationId, success: result.success, dryRun: payload.dryRun, sourceJobId: payload.sourceJobId },
      });

      return;
    }

    if (type === 'verify') {
      const payload = item.payload as OpsJobPayloadVerify;
      const plan = requireOpsPlan(payload.planId);

      appendJobLog(jobId, `Verify planId=${payload.planId}`);
      updateOpsJob(jobId, { progress: 10 });

      const verifyResult = await withTimeout(
        runOpsVerify({
          planId: payload.planId,
          requestId: payload.requestId,
          dryRun: plan.dryRun,
        }),
        jobTimeoutMs(),
        `verify jobId=${jobId}`,
      );

      updateOpsJob(jobId, { progress: 90, result: verifyResult });
      appendJobLog(jobId, `Verify verified=${verifyResult.verified} blocking=${verifyResult.blockingIssues.length}`);

      finalizeOpsJob(jobId, verifyResult.verified ? 'succeeded' : 'failed', verifyResult.verified ? 'verified' : 'blocked');

      await writeAuditLog({
        at: new Date().toISOString(),
        actor,
        action: 'ops.verify.completed',
        requestId: payload.requestId,
        metadata: { jobId, planId: payload.planId, verified: verifyResult.verified },
      });

      return;
    }

    throw new Error(`Unsupported job type: ${type}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    appendJobLog(jobId, `ERROR: ${message}`);
    updateOpsJob(jobId, { error: { message } });
    finalizeOpsJob(jobId, 'failed', message);

    await writeAuditLog({
      at: new Date().toISOString(),
      actor,
      action: `ops.job.${type}.failed`,
      requestId,
      metadata: { jobId, message },
    });
  }
}
