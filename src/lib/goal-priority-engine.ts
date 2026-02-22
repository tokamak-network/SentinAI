/**
 * Goal Priority Engine
 * Scores and prioritizes autonomous goals with deterministic suppression rules.
 */

import { randomUUID } from 'crypto';
import { getStore } from '@/lib/redis-store';
import type {
  AutonomousGoalCandidate,
  AutonomousGoalQueueItem,
  GoalPriorityScore,
  GoalSignalSnapshot,
  GoalSuppressionRecord,
  GoalSuppressionReasonCode,
} from '@/types/goal-manager';

const DEFAULT_POLICY = {
  minConfidence: 0.5,
  dedupWindowMinutes: 30,
  staleSignalMinutes: 90,
  defaultTtlMinutes: 60,
} as const;

export interface GoalPriorityPolicy {
  minConfidence: number;
  dedupWindowMinutes: number;
  staleSignalMinutes: number;
  defaultTtlMinutes: number;
}

export interface PrioritizeGoalCandidatesInput {
  snapshot: GoalSignalSnapshot;
  candidates: AutonomousGoalCandidate[];
  existingQueue?: AutonomousGoalQueueItem[];
  recentCandidates?: AutonomousGoalCandidate[];
  now?: number;
  policy?: Partial<GoalPriorityPolicy>;
}

export interface PrioritizeGoalCandidatesResult {
  queued: AutonomousGoalQueueItem[];
  suppressed: GoalSuppressionRecord[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toPolicy(partial?: Partial<GoalPriorityPolicy>): GoalPriorityPolicy {
  return {
    minConfidence: clamp(partial?.minConfidence ?? DEFAULT_POLICY.minConfidence, 0, 1),
    dedupWindowMinutes: clamp(partial?.dedupWindowMinutes ?? DEFAULT_POLICY.dedupWindowMinutes, 1, 1440),
    staleSignalMinutes: clamp(partial?.staleSignalMinutes ?? DEFAULT_POLICY.staleSignalMinutes, 1, 1440),
    defaultTtlMinutes: clamp(partial?.defaultTtlMinutes ?? DEFAULT_POLICY.defaultTtlMinutes, 5, 24 * 60),
  };
}

function parseTimestampMs(value?: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildImpactScore(candidate: AutonomousGoalCandidate, snapshot: GoalSignalSnapshot): number {
  const riskBase: Record<AutonomousGoalCandidate['risk'], number> = {
    low: 10,
    medium: 18,
    high: 28,
    critical: 35,
  };

  const sourceBonus: Record<AutonomousGoalCandidate['source'], number> = {
    metrics: 1,
    anomaly: 5,
    policy: 3,
    cost: 2,
    failover: 4,
    memory: 2,
  };

  let score = riskBase[candidate.risk] + sourceBonus[candidate.source];
  score += Math.min(4, snapshot.anomalies.activeCount);
  score += snapshot.anomalies.criticalCount > 0 ? 2 : 0;

  return clamp(Math.round(score), 0, 40);
}

function buildUrgencyScore(candidate: AutonomousGoalCandidate, snapshot: GoalSignalSnapshot): number {
  const cpu = snapshot.metrics.latestCpuUsage ?? 0;
  const txPool = snapshot.metrics.latestTxPoolPending ?? 0;
  let score = 5;

  if (candidate.intent === 'stabilize') {
    score += cpu >= 90 ? 12 : cpu >= 75 ? 8 : cpu >= 60 ? 4 : 0;
    score += txPool >= 2000 ? 8 : txPool >= 1000 ? 5 : txPool >= 500 ? 3 : 0;
    score += snapshot.metrics.txPoolTrend === 'rising' ? 2 : 0;
    score += snapshot.failover.recentCount > 0 ? 2 : 0;
  }

  if (candidate.intent === 'investigate') {
    score += snapshot.failover.recentCount > 0 ? 8 : 0;
    score += snapshot.memory.recentIncidentCount >= 3 ? 5 : 0;
    score += snapshot.anomalies.activeCount > 0 ? 4 : 0;
  }

  if (candidate.intent === 'cost-optimize') {
    score += snapshot.cost.avgUtilization <= 25 ? 8 : snapshot.cost.avgUtilization <= 40 ? 6 : 2;
    score += snapshot.cost.dataPointCount >= 72 ? 4 : 1;
    score -= snapshot.anomalies.activeCount > 0 ? 5 : 0;
  }

  if (candidate.intent === 'recover') {
    score += 10;
    score += snapshot.anomalies.criticalCount > 0 ? 5 : 0;
    score += snapshot.failover.recentCount > 0 ? 4 : 0;
  }

  return clamp(Math.round(score), 0, 25);
}

function buildPolicyFitScore(candidate: AutonomousGoalCandidate, snapshot: GoalSignalSnapshot): number {
  let score = 12;

  if (snapshot.policy.readOnlyMode) {
    if (candidate.intent === 'recover') score -= 8;
    if (candidate.intent === 'stabilize') score -= 5;
  }

  if (!snapshot.policy.autoScalingEnabled && candidate.intent === 'stabilize') {
    score -= 4;
  }

  if (candidate.source === 'cost') {
    score += 1;
  }

  return clamp(Math.round(score), 0, 15);
}

export function scoreGoalCandidate(
  candidate: AutonomousGoalCandidate,
  snapshot: GoalSignalSnapshot
): GoalPriorityScore {
  const impact = buildImpactScore(candidate, snapshot);
  const urgency = buildUrgencyScore(candidate, snapshot);
  const confidence = clamp(Math.round(candidate.confidence * 20), 0, 20);
  const policyFit = buildPolicyFitScore(candidate, snapshot);
  const total = impact + urgency + confidence + policyFit;

  return {
    impact,
    urgency,
    confidence,
    policyFit,
    total,
  };
}

function isDuplicateGoal(
  candidate: AutonomousGoalCandidate,
  now: number,
  policy: GoalPriorityPolicy,
  existingQueue: AutonomousGoalQueueItem[],
  recentCandidates: AutonomousGoalCandidate[]
): boolean {
  if (existingQueue.some((item) => item.signature === candidate.signature)) {
    return true;
  }

  const dedupCutoff = now - policy.dedupWindowMinutes * 60 * 1000;
  return recentCandidates.some((entry) => (
    entry.signature === candidate.signature &&
    parseTimestampMs(entry.updatedAt || entry.createdAt) >= dedupCutoff
  ));
}

function isStaleSnapshot(snapshot: GoalSignalSnapshot, now: number, policy: GoalPriorityPolicy): boolean {
  const collectedAt = parseTimestampMs(snapshot.collectedAt);
  if (collectedAt === 0) return true;
  return now - collectedAt > policy.staleSignalMinutes * 60 * 1000;
}

function evaluateSuppression(
  candidate: AutonomousGoalCandidate,
  snapshot: GoalSignalSnapshot,
  now: number,
  policy: GoalPriorityPolicy,
  existingQueue: AutonomousGoalQueueItem[],
  recentCandidates: AutonomousGoalCandidate[]
): GoalSuppressionReasonCode | null {
  if (isStaleSnapshot(snapshot, now, policy)) {
    return 'stale_signal';
  }

  if (candidate.confidence < policy.minConfidence) {
    return 'low_confidence';
  }

  if (
    snapshot.metrics.cooldownRemaining > 0 &&
    candidate.intent === 'stabilize' &&
    candidate.risk !== 'critical'
  ) {
    return 'cooldown_active';
  }

  if (
    snapshot.policy.readOnlyMode &&
    (candidate.intent === 'recover' || candidate.intent === 'stabilize')
  ) {
    return 'policy_blocked';
  }

  if (isDuplicateGoal(candidate, now, policy, existingQueue, recentCandidates)) {
    return 'duplicate_goal';
  }

  return null;
}

function buildSuppressionRecord(
  candidate: AutonomousGoalCandidate,
  reasonCode: GoalSuppressionReasonCode,
  now: number
): GoalSuppressionRecord {
  return {
    id: randomUUID(),
    timestamp: new Date(now).toISOString(),
    candidateId: candidate.id,
    signature: candidate.signature,
    source: candidate.source,
    risk: candidate.risk,
    reasonCode,
    details: `candidate=${candidate.goal}`,
  };
}

function toQueueItem(
  candidate: AutonomousGoalCandidate,
  score: GoalPriorityScore,
  now: number,
  ttlMinutes: number
): AutonomousGoalQueueItem {
  const nowIso = new Date(now).toISOString();
  const expiresAt = new Date(now + ttlMinutes * 60 * 1000).toISOString();

  return {
    goalId: randomUUID(),
    candidateId: candidate.id,
    enqueuedAt: nowIso,
    expiresAt,
    attempts: 0,
    status: 'queued',
    goal: candidate.goal,
    intent: candidate.intent,
    source: candidate.source,
    risk: candidate.risk,
    confidence: candidate.confidence,
    signature: candidate.signature,
    score,
    metadata: candidate.metadata,
  };
}

function sortQueue(queue: AutonomousGoalQueueItem[]): AutonomousGoalQueueItem[] {
  const riskRank: Record<AutonomousGoalQueueItem['risk'], number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  return [...queue].sort((a, b) => {
    const scoreDiff = b.score.total - a.score.total;
    if (scoreDiff !== 0) return scoreDiff;

    const riskDiff = riskRank[b.risk] - riskRank[a.risk];
    if (riskDiff !== 0) return riskDiff;

    const tsDiff = parseTimestampMs(a.enqueuedAt) - parseTimestampMs(b.enqueuedAt);
    if (tsDiff !== 0) return tsDiff;

    return a.goalId.localeCompare(b.goalId);
  });
}

export function prioritizeGoalCandidates(
  input: PrioritizeGoalCandidatesInput
): PrioritizeGoalCandidatesResult {
  const now = input.now ?? Date.now();
  const policy = toPolicy(input.policy);
  const existingQueue = input.existingQueue ?? [];
  const recentCandidates = input.recentCandidates ?? [];

  const queued: AutonomousGoalQueueItem[] = [];
  const suppressed: GoalSuppressionRecord[] = [];

  for (const candidate of input.candidates) {
    const reason = evaluateSuppression(
      candidate,
      input.snapshot,
      now,
      policy,
      existingQueue,
      recentCandidates
    );
    if (reason) {
      suppressed.push(buildSuppressionRecord(candidate, reason, now));
      continue;
    }

    const score = scoreGoalCandidate(candidate, input.snapshot);
    queued.push(toQueueItem(candidate, score, now, policy.defaultTtlMinutes));
  }

  return {
    queued: sortQueue(queued),
    suppressed,
  };
}

export async function persistSuppressionRecords(records: GoalSuppressionRecord[]): Promise<void> {
  if (records.length === 0) return;

  const store = getStore();
  await Promise.all(records.map((record) => store.addGoalSuppressionRecord(record)));
}
