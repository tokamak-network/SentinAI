/**
 * Goal Manager Runtime
 * Orchestrates signal collection -> candidate generation -> prioritization -> queue lifecycle.
 */

import { planAndExecuteGoal } from '@/lib/goal-planner';
import { evaluateGoalExecutionPolicy } from '@/lib/policy-engine';
import { collectGoalSignalSnapshot } from '@/lib/goal-signal-collector';
import { generateAutonomousGoalCandidates } from '@/lib/goal-candidate-generator';
import { persistSuppressionRecords, prioritizeGoalCandidates } from '@/lib/goal-priority-engine';
import { getStore } from '@/lib/redis-store';
import type {
  AutonomousGoalCandidate,
  AutonomousGoalQueueItem,
  GoalSuppressionRecord,
  GoalSignalSnapshot,
} from '@/types/goal-manager';
import type { GoalExecutionResult } from '@/types/goal-planner';

const DEFAULT_CANDIDATE_LIMIT = 6;
const DEFAULT_QUEUE_LIMIT = 100;

export interface GoalManagerConfig {
  enabled: boolean;
  dispatchEnabled: boolean;
  llmEnhancerEnabled: boolean;
  dispatchDryRun: boolean;
  dispatchAllowWrites: boolean;
}

export interface GoalManagerTickResult {
  enabled: boolean;
  snapshot?: GoalSignalSnapshot;
  generatedCount: number;
  queuedCount: number;
  suppressedCount: number;
  queueDepth: number;
  llmEnhanced: boolean;
  llmFallbackReason?: string;
}

export interface GoalDispatchResult {
  enabled: boolean;
  dispatched: boolean;
  goalId?: string;
  planId?: string;
  status?: GoalExecutionResult['plan']['status'];
  executionLogCount?: number;
  reason?: string;
  error?: string;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true';
}

function parseIntSafe(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getQueueLimit(): number {
  return parseIntSafe(process.env.GOAL_MANAGER_QUEUE_LIMIT, DEFAULT_QUEUE_LIMIT, 10, 500);
}

export function getGoalManagerConfig(): GoalManagerConfig {
  return {
    enabled: parseBoolean(process.env.GOAL_MANAGER_ENABLED, false),
    dispatchEnabled: parseBoolean(process.env.GOAL_MANAGER_DISPATCH_ENABLED, false),
    llmEnhancerEnabled: parseBoolean(process.env.GOAL_CANDIDATE_LLM_ENABLED, false),
    dispatchDryRun: parseBoolean(process.env.GOAL_MANAGER_DISPATCH_DRY_RUN, true),
    dispatchAllowWrites: parseBoolean(process.env.GOAL_MANAGER_DISPATCH_ALLOW_WRITES, false),
  };
}

function shouldExpireQueueItem(item: AutonomousGoalQueueItem, now: number): boolean {
  if (item.status === 'completed' || item.status === 'failed' || item.status === 'expired') {
    return false;
  }
  if (!item.expiresAt) return false;
  const expiresAt = new Date(item.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt <= now;
}

export async function expireGoalQueueItems(now: number = Date.now()): Promise<number> {
  const store = getStore();
  const queue = await store.getAutonomousGoalQueue(getQueueLimit());
  const candidates = queue.filter((item) => shouldExpireQueueItem(item, now));

  for (const item of candidates) {
    await store.upsertAutonomousGoalQueueItem({
      ...item,
      status: 'expired',
      finishedAt: new Date(now).toISOString(),
    });
  }

  return candidates.length;
}

export async function tickGoalManager(now: number = Date.now()): Promise<GoalManagerTickResult> {
  const config = getGoalManagerConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      generatedCount: 0,
      queuedCount: 0,
      suppressedCount: 0,
      queueDepth: 0,
      llmEnhanced: false,
      llmFallbackReason: 'goal_manager_disabled',
    };
  }

  const store = getStore();
  await expireGoalQueueItems(now);

  const snapshot = await collectGoalSignalSnapshot({ now });
  const generated = await generateAutonomousGoalCandidates(snapshot, {
    now,
    maxCandidates: DEFAULT_CANDIDATE_LIMIT,
    llmEnhancerEnabled: config.llmEnhancerEnabled,
  });

  const [existingQueue, recentCandidates] = await Promise.all([
    store.getAutonomousGoalQueue(getQueueLimit()),
    store.listAutonomousGoalCandidates(200),
  ]);

  const prioritized = prioritizeGoalCandidates({
    snapshot,
    candidates: generated.candidates,
    existingQueue,
    recentCandidates,
    now,
  });

  const suppressedByCandidateId = new Map(
    prioritized.suppressed.map((record) => [record.candidateId, record.reasonCode])
  );

  for (const candidate of generated.candidates) {
    const suppressionReasonCode = suppressedByCandidateId.get(candidate.id);
    const queueItem = prioritized.queued.find((item) => item.candidateId === candidate.id);

    await store.addAutonomousGoalCandidate({
      ...candidate,
      status: suppressionReasonCode ? 'suppressed' : queueItem ? 'queued' : candidate.status,
      score: queueItem?.score,
      suppressionReasonCode,
      updatedAt: new Date(now).toISOString(),
    });
  }

  await Promise.all(prioritized.queued.map((item) => store.upsertAutonomousGoalQueueItem(item)));
  await persistSuppressionRecords(prioritized.suppressed);

  const queueDepth = (await store.getAutonomousGoalQueue(getQueueLimit()))
    .filter((item) => item.status === 'queued' || item.status === 'scheduled' || item.status === 'running')
    .length;

  return {
    enabled: true,
    snapshot,
    generatedCount: generated.candidates.length,
    queuedCount: prioritized.queued.length,
    suppressedCount: prioritized.suppressed.length,
    queueDepth,
    llmEnhanced: generated.llmEnhanced,
    llmFallbackReason: generated.llmFallbackReason,
  };
}

export async function listGoalManagerState(limit: number = 50): Promise<{
  activeGoalId: string | null;
  queue: AutonomousGoalQueueItem[];
  candidates: AutonomousGoalCandidate[];
  suppression: GoalSuppressionRecord[];
}> {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const store = getStore();
  const [activeGoalId, queue, candidates, suppression] = await Promise.all([
    store.getActiveAutonomousGoalId(),
    store.getAutonomousGoalQueue(safeLimit),
    store.listAutonomousGoalCandidates(safeLimit),
    store.listGoalSuppressionRecords(safeLimit),
  ]);

  return {
    activeGoalId,
    queue,
    candidates,
    suppression,
  };
}

async function getNextQueuedGoal(): Promise<AutonomousGoalQueueItem | null> {
  const queue = await getStore().getAutonomousGoalQueue(getQueueLimit());
  return queue.find((item) => item.status === 'queued') || null;
}

async function updateGoalQueueItem(goalId: string, updates: Partial<AutonomousGoalQueueItem>): Promise<AutonomousGoalQueueItem | null> {
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

export async function dispatchTopGoal(options?: {
  now?: number;
  dryRun?: boolean;
  allowWrites?: boolean;
  initiatedBy?: 'scheduler' | 'api' | 'mcp';
}): Promise<GoalDispatchResult> {
  const config = getGoalManagerConfig();
  if (!config.enabled) {
    return { enabled: false, dispatched: false, reason: 'goal_manager_disabled' };
  }
  if (!config.dispatchEnabled) {
    return { enabled: true, dispatched: false, reason: 'dispatch_disabled' };
  }

  const now = options?.now ?? Date.now();
  const dryRun = options?.dryRun ?? config.dispatchDryRun;
  const allowWrites = options?.allowWrites ?? config.dispatchAllowWrites;
  const initiatedBy = options?.initiatedBy ?? 'scheduler';

  const nextGoal = await getNextQueuedGoal();
  if (!nextGoal) {
    return { enabled: true, dispatched: false, reason: 'queue_empty' };
  }

  await updateGoalQueueItem(nextGoal.goalId, {
    status: 'scheduled',
    scheduledAt: new Date(now).toISOString(),
  });
  await updateGoalQueueItem(nextGoal.goalId, {
    status: 'running',
    startedAt: new Date(now).toISOString(),
    attempts: nextGoal.attempts + 1,
  });
  await getStore().setActiveAutonomousGoalId(nextGoal.goalId);

  const policyDecision = evaluateGoalExecutionPolicy({
    autoExecute: true,
    allowWrites,
    readOnlyMode: process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true',
  });

  if (policyDecision.decision === 'deny') {
    await updateGoalQueueItem(nextGoal.goalId, {
      status: 'failed',
      finishedAt: new Date(now).toISOString(),
      lastError: policyDecision.message,
    });
    await getStore().setActiveAutonomousGoalId(null);
    return {
      enabled: true,
      dispatched: true,
      goalId: nextGoal.goalId,
      status: 'failed',
      reason: policyDecision.reasonCode,
      error: policyDecision.message,
    };
  }

  try {
    const result = await planAndExecuteGoal(nextGoal.goal, {
      dryRun,
      allowWrites,
      initiatedBy,
    });

    if (result.plan.status === 'completed') {
      await updateGoalQueueItem(nextGoal.goalId, {
        status: 'completed',
        finishedAt: new Date().toISOString(),
        planId: result.plan.planId,
      });
    } else {
      const failedStep = result.executionLog.find((entry) => entry.status === 'failed');
      await updateGoalQueueItem(nextGoal.goalId, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        lastError: failedStep?.message || 'goal execution failed',
        planId: result.plan.planId,
      });
    }

    await getStore().setActiveAutonomousGoalId(null);
    return {
      enabled: true,
      dispatched: true,
      goalId: nextGoal.goalId,
      planId: result.plan.planId,
      status: result.plan.status,
      executionLogCount: result.executionLog.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await updateGoalQueueItem(nextGoal.goalId, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      lastError: message,
    });
    await getStore().setActiveAutonomousGoalId(null);
    return {
      enabled: true,
      dispatched: true,
      goalId: nextGoal.goalId,
      status: 'failed',
      error: message,
    };
  }
}
