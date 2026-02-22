import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  persistSuppressionRecords,
  prioritizeGoalCandidates,
  scoreGoalCandidate,
} from '@/lib/goal-priority-engine';
import type {
  AutonomousGoalCandidate,
  GoalSignalSnapshot,
  GoalSuppressionRecord,
} from '@/types/goal-manager';

const hoisted = vi.hoisted(() => ({
  addGoalSuppressionRecord: vi.fn(),
}));

vi.mock('@/lib/redis-store', () => ({
  getStore: () => ({
    addGoalSuppressionRecord: hoisted.addGoalSuppressionRecord,
  }),
}));

function createSnapshot(overrides?: Partial<GoalSignalSnapshot>): GoalSignalSnapshot {
  return {
    snapshotId: 'snapshot-1',
    collectedAt: '2026-02-22T12:00:00.000Z',
    chainType: 'thanos',
    sources: ['metrics', 'anomaly', 'policy', 'cost', 'failover', 'memory'],
    metrics: {
      latestCpuUsage: 84,
      latestTxPoolPending: 1400,
      latestGasUsedRatio: 0.82,
      currentVcpu: 2,
      cooldownRemaining: 0,
      cpuTrend: 'rising',
      txPoolTrend: 'rising',
      gasTrend: 'rising',
    },
    anomalies: {
      activeCount: 2,
      criticalCount: 1,
      latestEventTimestamp: '2026-02-22T11:58:00.000Z',
    },
    failover: {
      recentCount: 1,
      latestEventTimestamp: '2026-02-22T11:50:00.000Z',
      activeL1RpcUrl: 'https://rpc.sepolia.org',
    },
    cost: {
      avgVcpu: 2.4,
      peakVcpu: 4,
      avgUtilization: 55,
      dataPointCount: 160,
    },
    memory: {
      recentEntryCount: 5,
      recentIncidentCount: 3,
      recentHighSeverityCount: 2,
      latestEntryTimestamp: '2026-02-22T11:45:00.000Z',
    },
    policy: {
      readOnlyMode: false,
      autoScalingEnabled: true,
    },
    ...overrides,
  };
}

function createCandidate(overrides?: Partial<AutonomousGoalCandidate>): AutonomousGoalCandidate {
  return {
    id: `candidate-${Math.random()}`,
    createdAt: '2026-02-22T12:00:00.000Z',
    updatedAt: '2026-02-22T12:00:00.000Z',
    source: 'anomaly',
    status: 'candidate',
    goal: 'L2 안정화 목표',
    intent: 'stabilize',
    risk: 'high',
    confidence: 0.82,
    signature: `sig-${Math.random()}`,
    rationale: 'active anomaly and high txpool',
    signalSnapshotId: 'snapshot-1',
    ...overrides,
  };
}

describe('goal-priority-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should compute score breakdown within expected ranges', () => {
    const snapshot = createSnapshot();
    const candidate = createCandidate();

    const score = scoreGoalCandidate(candidate, snapshot);

    expect(score.impact).toBeGreaterThanOrEqual(0);
    expect(score.impact).toBeLessThanOrEqual(40);
    expect(score.urgency).toBeGreaterThanOrEqual(0);
    expect(score.urgency).toBeLessThanOrEqual(25);
    expect(score.confidence).toBeGreaterThanOrEqual(0);
    expect(score.confidence).toBeLessThanOrEqual(20);
    expect(score.policyFit).toBeGreaterThanOrEqual(0);
    expect(score.policyFit).toBeLessThanOrEqual(15);
    expect(score.total).toBe(score.impact + score.urgency + score.confidence + score.policyFit);
  });

  it('should suppress low-confidence candidates', () => {
    const snapshot = createSnapshot();
    const candidate = createCandidate({ confidence: 0.2 });

    const result = prioritizeGoalCandidates({
      snapshot,
      candidates: [candidate],
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
      policy: { minConfidence: 0.5 },
    });

    expect(result.queued).toHaveLength(0);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].reasonCode).toBe('low_confidence');
  });

  it('should suppress duplicate goals by signature', () => {
    const snapshot = createSnapshot();
    const candidate = createCandidate({ signature: 'dup-sig' });

    const result = prioritizeGoalCandidates({
      snapshot,
      candidates: [candidate],
      existingQueue: [
        {
          goalId: 'goal-1',
          candidateId: 'candidate-prev',
          enqueuedAt: '2026-02-22T11:55:00.000Z',
          attempts: 0,
          status: 'queued',
          goal: 'existing goal',
          intent: 'stabilize',
          source: 'anomaly',
          risk: 'high',
          confidence: 0.8,
          signature: 'dup-sig',
          score: { impact: 30, urgency: 20, confidence: 16, policyFit: 10, total: 76 },
        },
      ],
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
    });

    expect(result.queued).toHaveLength(0);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].reasonCode).toBe('duplicate_goal');
  });

  it('should suppress stabilize candidate during cooldown', () => {
    const snapshot = createSnapshot({
      metrics: {
        latestCpuUsage: 84,
        latestTxPoolPending: 1400,
        latestGasUsedRatio: 0.82,
        currentVcpu: 2,
        cooldownRemaining: 180,
        cpuTrend: 'rising',
        txPoolTrend: 'rising',
        gasTrend: 'rising',
      },
    });
    const candidate = createCandidate({ intent: 'stabilize', risk: 'high' });

    const result = prioritizeGoalCandidates({
      snapshot,
      candidates: [candidate],
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
    });

    expect(result.queued).toHaveLength(0);
    expect(result.suppressed[0].reasonCode).toBe('cooldown_active');
  });

  it('should suppress candidates when snapshot is stale', () => {
    const snapshot = createSnapshot({
      collectedAt: '2026-02-22T08:00:00.000Z',
    });
    const candidate = createCandidate();

    const result = prioritizeGoalCandidates({
      snapshot,
      candidates: [candidate],
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
      policy: { staleSignalMinutes: 60 },
    });

    expect(result.queued).toHaveLength(0);
    expect(result.suppressed[0].reasonCode).toBe('stale_signal');
  });

  it('should suppress blocked write-like intents in read-only mode', () => {
    const snapshot = createSnapshot({
      policy: {
        readOnlyMode: true,
        autoScalingEnabled: true,
      },
    });
    const candidate = createCandidate({ intent: 'recover', source: 'policy' });

    const result = prioritizeGoalCandidates({
      snapshot,
      candidates: [candidate],
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
    });

    expect(result.queued).toHaveLength(0);
    expect(result.suppressed[0].reasonCode).toBe('policy_blocked');
  });

  it('should queue candidates and sort by total score descending', () => {
    const snapshot = createSnapshot();
    const high = createCandidate({
      id: 'high',
      risk: 'critical',
      confidence: 0.95,
      goal: 'critical stabilization',
      signature: 'sig-high',
    });
    const low = createCandidate({
      id: 'low',
      risk: 'low',
      confidence: 0.55,
      goal: 'routine investigation',
      signature: 'sig-low',
      source: 'memory',
      intent: 'investigate',
    });

    const result = prioritizeGoalCandidates({
      snapshot,
      candidates: [low, high],
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
    });

    expect(result.suppressed).toHaveLength(0);
    expect(result.queued).toHaveLength(2);
    expect(result.queued[0].score.total).toBeGreaterThanOrEqual(result.queued[1].score.total);
  });

  it('should persist suppression records to state store', async () => {
    const records: GoalSuppressionRecord[] = [
      {
        id: 's1',
        timestamp: '2026-02-22T12:00:00.000Z',
        candidateId: 'c1',
        signature: 'sig-1',
        source: 'metrics',
        risk: 'medium',
        reasonCode: 'low_confidence',
      },
      {
        id: 's2',
        timestamp: '2026-02-22T12:01:00.000Z',
        candidateId: 'c2',
        signature: 'sig-2',
        source: 'policy',
        risk: 'high',
        reasonCode: 'policy_blocked',
      },
    ];

    await persistSuppressionRecords(records);

    expect(hoisted.addGoalSuppressionRecord).toHaveBeenCalledTimes(2);
    expect(hoisted.addGoalSuppressionRecord).toHaveBeenNthCalledWith(1, records[0]);
    expect(hoisted.addGoalSuppressionRecord).toHaveBeenNthCalledWith(2, records[1]);
  });
});
