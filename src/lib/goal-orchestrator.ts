/**
 * Goal Orchestrator
 * Durable dispatch execution with lease, idempotency, checkpoint, retry, and DLQ.
 */

import { createHash, randomUUID } from 'crypto';
import { recordGoalLearningEpisode } from '@/lib/goal-learning';
import { planAndExecuteGoal } from '@/lib/goal-planner';
import { evaluateGoalExecutionPolicy } from '@/lib/policy-engine';
import { getStore } from '@/lib/redis-store';
import type { AutonomousGoalQueueItem } from '@/types/goal-manager';
import type {
  GoalDlqItem,
  GoalExecutionCheckpoint,
  GoalIdempotencyRecord,
  GoalLeaseRecord,
  GoalRetryPolicy,
} from '@/types/goal-orchestrator';

export interface DispatchNextGoalOptions {
  now?: number;
  dryRun: boolean;
  allowWrites: boolean;
  initiatedBy: 'scheduler' | 'api' | 'mcp';
}

export interface DispatchNextGoalResult {
  dispatched: boolean;
  goalId?: string;
  planId?: string;
  status?: AutonomousGoalQueueItem['status'];
  executionLogCount?: number;
  reason?: string;
  error?: string;
}

export interface ReplayDlqGoalResult {
  replayed: boolean;
  goalId?: string;
  reason?: string;
}

const DEFAULT_RETRY_POLICY: GoalRetryPolicy = {
  maxRetries: 2,
  baseBackoffMs: 15_000,
  maxBackoffMs: 5 * 60_000,
};

const DEFAULT_LEASE_TTL_SECONDS = 120;
const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 60 * 60; // 1 hour

const ORCHESTRATOR_OWNER_ID = `${process.pid}-${Math.random().toString(16).slice(2, 8)}`;

function parseIntSafe(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getRetryPolicy(): GoalRetryPolicy {
  return {
    maxRetries: parseIntSafe(process.env.GOAL_ORCHESTRATOR_MAX_RETRIES, DEFAULT_RETRY_POLICY.maxRetries, 0, 10),
    baseBackoffMs: parseIntSafe(process.env.GOAL_ORCHESTRATOR_BACKOFF_BASE_MS, DEFAULT_RETRY_POLICY.baseBackoffMs, 1000, 900_000),
    maxBackoffMs: parseIntSafe(process.env.GOAL_ORCHESTRATOR_BACKOFF_MAX_MS, DEFAULT_RETRY_POLICY.maxBackoffMs, 1000, 3_600_000),
  };
}

function getLeaseTtlSeconds(): number {
  return parseIntSafe(process.env.GOAL_ORCHESTRATOR_LEASE_TTL_SECONDS, DEFAULT_LEASE_TTL_SECONDS, 30, 3600);
}

function getIdempotencyTtlSeconds(): number {
  return parseIntSafe(process.env.GOAL_ORCHESTRATOR_IDEMPOTENCY_TTL_SECONDS, DEFAULT_IDEMPOTENCY_TTL_SECONDS, 30, 7 * 24 * 3600);
}

function parseTimeMs(value?: string): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeBackoffMs(attempt: number, policy: GoalRetryPolicy): number {
  const raw = policy.baseBackoffMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(raw, policy.maxBackoffMs);
}

function isQueueItemDispatchable(item: AutonomousGoalQueueItem, now: number): boolean {
  if (item.status !== 'queued') return false;
  if (!item.nextAttemptAt) return true;
  return parseTimeMs(item.nextAttemptAt) <= now;
}

function buildIdempotencyKey(item: AutonomousGoalQueueItem, dryRun: boolean, allowWrites: boolean): string {
  return createHash('sha256')
    .update(`${item.goalId}|${item.signature}|${dryRun}|${allowWrites}`)
    .digest('hex')
    .slice(0, 40);
}

async function getNextQueuedGoal(now: number): Promise<AutonomousGoalQueueItem | null> {
  const queue = await getStore().getAutonomousGoalQueue(500);
  return queue.find((item) => isQueueItemDispatchable(item, now)) || null;
}

async function updateQueueItem(
  goalId: string,
  updates: Partial<AutonomousGoalQueueItem>
): Promise<AutonomousGoalQueueItem | null> {
  const store = getStore();
  const current = await store.getAutonomousGoalQueueItem(goalId);
  if (!current) return null;

  const next: AutonomousGoalQueueItem = {
    ...current,
    ...updates,
  };
  await store.upsertAutonomousGoalQueueItem(next);
  return next;
}

async function writeCheckpoint(
  goalId: string,
  phase: GoalExecutionCheckpoint['phase'],
  now: number,
  details?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await getStore().setGoalCheckpoint(goalId, {
    goalId,
    phase,
    timestamp: new Date(now).toISOString(),
    details,
    metadata,
  });
}

async function acquireGoalLease(goalId: string, now: number): Promise<GoalLeaseRecord | null> {
  const store = getStore();
  const existing = await store.getGoalLease(goalId);
  if (existing) {
    const expiresAt = parseTimeMs(existing.leaseExpiresAt);
    if (expiresAt > now) {
      return null;
    }
    await store.clearGoalLease(goalId);
  }

  const ttlSeconds = getLeaseTtlSeconds();
  const lease: GoalLeaseRecord = {
    goalId,
    ownerId: ORCHESTRATOR_OWNER_ID,
    leasedAt: new Date(now).toISOString(),
    leaseExpiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
    heartbeatAt: new Date(now).toISOString(),
    version: (existing?.version || 0) + 1,
  };

  await store.setGoalLease(goalId, lease);
  return lease;
}

async function releaseGoalLease(goalId: string): Promise<void> {
  const store = getStore();
  await store.clearGoalLease(goalId);
  await store.clearGoalCheckpoint(goalId);
  await store.setActiveAutonomousGoalId(null);
}

function buildIdempotencyRecord(goalId: string, key: string, now: number): GoalIdempotencyRecord {
  const ttlSeconds = getIdempotencyTtlSeconds();
  return {
    key,
    goalId,
    ownerId: ORCHESTRATOR_OWNER_ID,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
  };
}

async function toDlqItem(
  queueItem: AutonomousGoalQueueItem,
  reason: string,
  now: number
): Promise<GoalDlqItem> {
  return {
    id: randomUUID(),
    goalId: queueItem.goalId,
    movedAt: new Date(now).toISOString(),
    reason,
    attempts: queueItem.attempts,
    lastError: queueItem.lastError,
    queueItem,
  };
}

async function recordExecutionEpisode(
  queueItem: AutonomousGoalQueueItem,
  outcome: 'completed' | 'failed' | 'requeued' | 'dlq',
  options: {
    now: number;
    verificationPassed?: boolean;
    rollbackTriggered?: boolean;
    rollbackSucceeded?: boolean;
    executionLatencyMs?: number;
    details?: string;
  }
): Promise<void> {
  await recordGoalLearningEpisode({
    timestamp: new Date(options.now).toISOString(),
    stage: 'execution',
    snapshotId: typeof queueItem.metadata?.signalSnapshotId === 'string'
      ? queueItem.metadata.signalSnapshotId
      : 'unknown',
    goalId: queueItem.goalId,
    candidateId: queueItem.candidateId,
    intent: queueItem.intent,
    source: queueItem.source,
    risk: queueItem.risk,
    confidence: queueItem.confidence,
    scoreTotal: queueItem.score.total,
    outcome,
    verificationPassed: options.verificationPassed,
    rollbackTriggered: options.rollbackTriggered,
    rollbackSucceeded: options.rollbackSucceeded,
    executionLatencyMs: options.executionLatencyMs,
    metadata: options.details ? { details: options.details } : undefined,
  });
}

export async function dispatchNextGoalWithOrchestration(
  options: DispatchNextGoalOptions
): Promise<DispatchNextGoalResult> {
  const store = getStore();
  const now = options.now ?? Date.now();
  const retryPolicy = getRetryPolicy();

  const queueItem = await getNextQueuedGoal(now);
  if (!queueItem) {
    return { dispatched: false, reason: 'queue_empty' };
  }

  await updateQueueItem(queueItem.goalId, {
    status: 'scheduled',
    scheduledAt: new Date(now).toISOString(),
  });
  await writeCheckpoint(queueItem.goalId, 'scheduled', now);

  const lease = await acquireGoalLease(queueItem.goalId, now);
  if (!lease) {
    await writeCheckpoint(queueItem.goalId, 'failed', now, 'lease_active');
    return {
      dispatched: false,
      goalId: queueItem.goalId,
      reason: 'lease_active',
    };
  }

  await store.setActiveAutonomousGoalId(queueItem.goalId);
  await writeCheckpoint(queueItem.goalId, 'lease_acquired', now, undefined, {
    ownerId: lease.ownerId,
    leaseExpiresAt: lease.leaseExpiresAt,
  });

  const idempotencyKey = buildIdempotencyKey(queueItem, options.dryRun, options.allowWrites);
  const registered = await store.registerGoalIdempotency(
    buildIdempotencyRecord(queueItem.goalId, idempotencyKey, now)
  );
  if (!registered) {
    await updateQueueItem(queueItem.goalId, {
      status: 'failed',
      finishedAt: new Date(now).toISOString(),
      lastError: 'idempotency duplicate',
      idempotencyKey,
    });
    await writeCheckpoint(queueItem.goalId, 'failed', now, 'idempotency_duplicate');
    await recordExecutionEpisode(queueItem, 'failed', {
      now,
      details: 'idempotency duplicate',
    });
    await releaseGoalLease(queueItem.goalId);
    return {
      dispatched: true,
      goalId: queueItem.goalId,
      status: 'failed',
      reason: 'idempotency_duplicate',
      error: 'idempotency duplicate',
    };
  }

  await updateQueueItem(queueItem.goalId, {
    status: 'running',
    startedAt: new Date(now).toISOString(),
    attempts: queueItem.attempts + 1,
    idempotencyKey,
    leaseOwner: lease.ownerId,
    leaseExpiresAt: lease.leaseExpiresAt,
  });

  const policyDecision = evaluateGoalExecutionPolicy({
    autoExecute: true,
    allowWrites: options.allowWrites,
    readOnlyMode: process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true',
    risk: queueItem.risk,
    confidence: queueItem.confidence,
  });
  await writeCheckpoint(queueItem.goalId, 'policy_check', now, policyDecision.reasonCode);

  if (policyDecision.decision === 'deny' || policyDecision.decision === 'require_approval') {
    await updateQueueItem(queueItem.goalId, {
      status: 'failed',
      finishedAt: new Date(now).toISOString(),
      lastError: policyDecision.message,
    });
    await writeCheckpoint(queueItem.goalId, 'failed', now, policyDecision.message);
    await recordExecutionEpisode(queueItem, 'failed', {
      now,
      details: policyDecision.message,
    });
    await releaseGoalLease(queueItem.goalId);
    return {
      dispatched: true,
      goalId: queueItem.goalId,
      status: 'failed',
      reason: policyDecision.reasonCode,
      error: policyDecision.message,
    };
  }

  try {
    await writeCheckpoint(queueItem.goalId, 'plan_started', now);
    const execution = await planAndExecuteGoal(queueItem.goal, {
      dryRun: options.dryRun,
      allowWrites: options.allowWrites,
      initiatedBy: options.initiatedBy,
    });
    await writeCheckpoint(queueItem.goalId, 'plan_completed', now, execution.plan.status);

    if (execution.plan.status === 'completed') {
      await updateQueueItem(queueItem.goalId, {
        status: 'completed',
        finishedAt: new Date().toISOString(),
        planId: execution.plan.planId,
      });
      await writeCheckpoint(queueItem.goalId, 'verify_completed', now);
      await recordExecutionEpisode(queueItem, 'completed', {
        now,
        verificationPassed: true,
        executionLatencyMs: Date.now() - now,
      });
      await releaseGoalLease(queueItem.goalId);
      return {
        dispatched: true,
        goalId: queueItem.goalId,
        planId: execution.plan.planId,
        status: 'completed',
        executionLogCount: execution.executionLog.length,
      };
    }

    const failedStep = execution.executionLog.find((step) => step.status === 'failed');
    const failureMessage = failedStep?.message || 'goal execution failed';
    const failedAttempts = queueItem.attempts + 1;

    if (failedAttempts > retryPolicy.maxRetries) {
      const failedItem = await updateQueueItem(queueItem.goalId, {
        status: 'dlq',
        finishedAt: new Date(now).toISOString(),
        planId: execution.plan.planId,
        lastError: failureMessage,
      });
      if (failedItem) {
        await store.addGoalDlqItem(await toDlqItem(failedItem, 'max_retries_exceeded', now));
      }
      await writeCheckpoint(queueItem.goalId, 'dlq', now, failureMessage);
      await recordExecutionEpisode(queueItem, 'dlq', {
        now,
        verificationPassed: false,
        executionLatencyMs: Date.now() - now,
        details: failureMessage,
      });
      await releaseGoalLease(queueItem.goalId);
      return {
        dispatched: true,
        goalId: queueItem.goalId,
        planId: execution.plan.planId,
        status: 'dlq',
        executionLogCount: execution.executionLog.length,
        error: failureMessage,
      };
    }

    const backoffMs = computeBackoffMs(failedAttempts, retryPolicy);
    await updateQueueItem(queueItem.goalId, {
      status: 'queued',
      nextAttemptAt: new Date(now + backoffMs).toISOString(),
      finishedAt: undefined,
      startedAt: undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastError: failureMessage,
      planId: execution.plan.planId,
    });
    await writeCheckpoint(queueItem.goalId, 'requeued', now, failureMessage, { backoffMs });
    await recordExecutionEpisode(queueItem, 'requeued', {
      now,
      verificationPassed: false,
      executionLatencyMs: Date.now() - now,
      details: failureMessage,
    });
    await releaseGoalLease(queueItem.goalId);
    return {
      dispatched: true,
      goalId: queueItem.goalId,
      planId: execution.plan.planId,
      status: 'queued',
      executionLogCount: execution.executionLog.length,
      reason: 'requeued',
      error: failureMessage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const failedAttempts = queueItem.attempts + 1;

    if (failedAttempts > retryPolicy.maxRetries) {
      const failedItem = await updateQueueItem(queueItem.goalId, {
        status: 'dlq',
        finishedAt: new Date(now).toISOString(),
        lastError: message,
      });
      if (failedItem) {
        await store.addGoalDlqItem(await toDlqItem(failedItem, 'runtime_exception', now));
      }
      await writeCheckpoint(queueItem.goalId, 'dlq', now, message);
      await recordExecutionEpisode(queueItem, 'dlq', {
        now,
        verificationPassed: false,
        executionLatencyMs: Date.now() - now,
        details: message,
      });
      await releaseGoalLease(queueItem.goalId);
      return {
        dispatched: true,
        goalId: queueItem.goalId,
        status: 'dlq',
        error: message,
      };
    }

    const backoffMs = computeBackoffMs(failedAttempts, retryPolicy);
    await updateQueueItem(queueItem.goalId, {
      status: 'queued',
      nextAttemptAt: new Date(now + backoffMs).toISOString(),
      finishedAt: undefined,
      startedAt: undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastError: message,
    });
    await writeCheckpoint(queueItem.goalId, 'requeued', now, message, { backoffMs });
    await recordExecutionEpisode(queueItem, 'requeued', {
      now,
      verificationPassed: false,
      executionLatencyMs: Date.now() - now,
      details: message,
    });
    await releaseGoalLease(queueItem.goalId);
    return {
      dispatched: true,
      goalId: queueItem.goalId,
      status: 'queued',
      reason: 'requeued',
      error: message,
    };
  }
}

export async function replayGoalFromDlq(goalId: string, now: number = Date.now()): Promise<ReplayDlqGoalResult> {
  const store = getStore();
  const dlqItems = await store.listGoalDlqItems(500);
  const target = dlqItems.find((item) => item.goalId === goalId);
  if (!target) {
    return { replayed: false, reason: 'dlq_item_not_found' };
  }

  const replayItem: AutonomousGoalQueueItem = {
    ...target.queueItem,
    status: 'queued',
    nextAttemptAt: new Date(now).toISOString(),
    scheduledAt: undefined,
    startedAt: undefined,
    finishedAt: undefined,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    lastError: undefined,
  };

  await store.upsertAutonomousGoalQueueItem(replayItem);
  await store.removeGoalDlqItem(goalId);
  await store.clearGoalLease(goalId);
  await store.clearGoalCheckpoint(goalId);

  return {
    replayed: true,
    goalId,
  };
}
