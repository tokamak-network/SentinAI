/**
 * Goal Manager Runtime
 * Orchestrates signal collection -> candidate generation -> prioritization -> queue lifecycle.
 */

import {
  dispatchNextGoalWithOrchestration,
  replayGoalFromDlq,
  type ReplayDlqGoalResult,
} from '@/lib/goal-orchestrator';
import { recordGoalLearningEpisode } from '@/lib/goal-learning';
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
import type { GoalDlqItem } from '@/types/goal-orchestrator';

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
  status?: AutonomousGoalQueueItem['status'];
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
    const outcome = suppressionReasonCode ? 'suppressed' : queueItem ? 'queued' : 'suppressed';

    await store.addAutonomousGoalCandidate({
      ...candidate,
      status: suppressionReasonCode ? 'suppressed' : queueItem ? 'queued' : candidate.status,
      score: queueItem?.score,
      suppressionReasonCode,
      updatedAt: new Date(now).toISOString(),
    });

    await recordGoalLearningEpisode({
      timestamp: new Date(now).toISOString(),
      stage: 'selection',
      snapshotId: snapshot.snapshotId,
      goalId: queueItem?.goalId,
      candidateId: candidate.id,
      intent: candidate.intent,
      source: candidate.source,
      risk: candidate.risk,
      confidence: candidate.confidence,
      scoreTotal: queueItem?.score.total,
      suppressionReasonCode,
      outcome,
      metadata: {
        signalSnapshotId: candidate.signalSnapshotId,
      },
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
  dlq: GoalDlqItem[];
}> {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const store = getStore();
  const [activeGoalId, queue, candidates, suppression, dlq] = await Promise.all([
    store.getActiveAutonomousGoalId(),
    store.getAutonomousGoalQueue(safeLimit),
    store.listAutonomousGoalCandidates(safeLimit),
    store.listGoalSuppressionRecords(safeLimit),
    store.listGoalDlqItems(safeLimit),
  ]);

  return {
    activeGoalId,
    queue,
    candidates,
    suppression,
    dlq,
  };
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
  const result = await dispatchNextGoalWithOrchestration({
    now,
    dryRun,
    allowWrites,
    initiatedBy,
  });

  return {
    enabled: true,
    ...result,
  };
}

export async function replayGoalManagerDlq(goalId: string, now?: number): Promise<ReplayDlqGoalResult> {
  return replayGoalFromDlq(goalId, now);
}
