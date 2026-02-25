import { randomUUID } from 'crypto';
import type { OpsJobRecord, OpsPlanRecord, OpsJobType } from '@/lib/ops-adapter/types';

const globalForOps = globalThis as unknown as {
  __sentinai_ops_plans?: Map<string, OpsPlanRecord>;
  __sentinai_ops_jobs?: Map<string, OpsJobRecord>;
};

export function getOpsPlanStore(): Map<string, OpsPlanRecord> {
  if (!globalForOps.__sentinai_ops_plans) {
    globalForOps.__sentinai_ops_plans = new Map();
  }
  return globalForOps.__sentinai_ops_plans;
}

export function getOpsJobStore(): Map<string, OpsJobRecord> {
  if (!globalForOps.__sentinai_ops_jobs) {
    globalForOps.__sentinai_ops_jobs = new Map();
  }
  return globalForOps.__sentinai_ops_jobs;
}

export function createOpsPlan(input: Omit<OpsPlanRecord, 'planId' | 'createdAt' | 'confirmToken'> & { confirmToken?: string }): OpsPlanRecord {
  const planId = randomUUID();
  const createdAt = new Date().toISOString();
  const confirmToken = input.confirmToken || randomUUID();

  const record: OpsPlanRecord = {
    ...input,
    planId,
    createdAt,
    confirmToken,
  };

  getOpsPlanStore().set(planId, record);
  return record;
}

export function requireOpsPlan(planId: string): OpsPlanRecord {
  const plan = getOpsPlanStore().get(planId);
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }
  return plan;
}

export function createOpsJob(input: {
  type: OpsJobType;
  requestId?: string;
  planId?: string;
  operationId?: string;
  dryRun?: boolean;
  summary?: string;
}): OpsJobRecord {
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const job: OpsJobRecord = {
    jobId,
    type: input.type,
    status: 'queued',
    progress: 0,
    summary: input.summary,
    logs: [],
    startedAt: now,
    updatedAt: now,
    planId: input.planId,
    operationId: input.operationId,
    requestId: input.requestId,
    dryRun: input.dryRun,
  };

  getOpsJobStore().set(jobId, job);
  return job;
}

export function requireOpsJob(jobId: string): OpsJobRecord {
  const job = getOpsJobStore().get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  return job;
}

export function findOpsJobByOperationId(operationId: string): OpsJobRecord | null {
  for (const job of getOpsJobStore().values()) {
    if (job.operationId === operationId) return job;
  }
  return null;
}

export function updateOpsJob(jobId: string, patch: Partial<OpsJobRecord>): OpsJobRecord {
  const store = getOpsJobStore();
  const existing = store.get(jobId);
  if (!existing) throw new Error(`Job not found: ${jobId}`);
  const updated: OpsJobRecord = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  store.set(jobId, updated);
  return updated;
}

export function appendJobLog(jobId: string, line: string): void {
  const store = getOpsJobStore();
  const existing = store.get(jobId);
  if (!existing) return;
  existing.logs.push(line);
  existing.updatedAt = new Date().toISOString();
  store.set(jobId, existing);
}

export function finalizeOpsJob(jobId: string, status: 'succeeded' | 'failed' | 'cancelled', summary?: string): OpsJobRecord {
  const now = new Date().toISOString();
  return updateOpsJob(jobId, {
    status,
    progress: 100,
    summary,
    finishedAt: now,
  });
}
