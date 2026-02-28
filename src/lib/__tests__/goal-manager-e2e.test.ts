import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchTopGoal, tickGoalManager } from '@/lib/goal-manager';
import type {
  AutonomousGoalCandidate,
  AutonomousGoalQueueItem,
  GoalSignalSnapshot,
  GoalSuppressionRecord,
} from '@/types/goal-manager';
import type {
  GoalDlqItem,
  GoalExecutionCheckpoint,
  GoalIdempotencyRecord,
  GoalLeaseRecord,
} from '@/types/goal-orchestrator';

type MockStoreState = {
  candidates: AutonomousGoalCandidate[];
  queue: AutonomousGoalQueueItem[];
  suppression: GoalSuppressionRecord[];
  activeGoalId: string | null;
  goalLeases: Map<string, GoalLeaseRecord>;
  goalCheckpoints: Map<string, GoalExecutionCheckpoint>;
  goalDlqItems: GoalDlqItem[];
  goalIdempotency: Map<string, GoalIdempotencyRecord>;
  goalLearningEpisodes: Array<Record<string, unknown>>;
};

const hoisted = vi.hoisted(() => {
  const storeState: MockStoreState = {
    candidates: [],
    queue: [],
    suppression: [],
    activeGoalId: null,
    goalLeases: new Map(),
    goalCheckpoints: new Map(),
    goalDlqItems: [],
    goalIdempotency: new Map(),
    goalLearningEpisodes: [],
  };

  const sortQueue = (): void => {
    storeState.queue.sort((a, b) => b.score.total - a.score.total);
  };

  const mockStore = {
    addAutonomousGoalCandidate: vi.fn(async (candidate: AutonomousGoalCandidate) => {
      storeState.candidates.unshift(candidate);
    }),
    listAutonomousGoalCandidates: vi.fn(async (limit: number = 50) => storeState.candidates.slice(0, limit)),
    clearAutonomousGoalCandidates: vi.fn(async () => {
      storeState.candidates = [];
    }),
    getAutonomousGoalQueue: vi.fn(async (limit: number = 50) => storeState.queue.slice(0, limit)),
    getAutonomousGoalQueueItem: vi.fn(async (goalId: string) => (
      storeState.queue.find((item) => item.goalId === goalId) || null
    )),
    upsertAutonomousGoalQueueItem: vi.fn(async (item: AutonomousGoalQueueItem) => {
      storeState.queue = storeState.queue.filter((entry) => entry.goalId !== item.goalId);
      storeState.queue.push(item);
      sortQueue();
    }),
    clearAutonomousGoalQueue: vi.fn(async () => {
      storeState.queue = [];
    }),
    setActiveAutonomousGoalId: vi.fn(async (goalId: string | null) => {
      storeState.activeGoalId = goalId;
    }),
    getActiveAutonomousGoalId: vi.fn(async () => storeState.activeGoalId),
    addGoalSuppressionRecord: vi.fn(async (record: GoalSuppressionRecord) => {
      storeState.suppression.unshift(record);
    }),
    listGoalSuppressionRecords: vi.fn(async (limit: number = 50) => storeState.suppression.slice(0, limit)),
    clearGoalSuppressionRecords: vi.fn(async () => {
      storeState.suppression = [];
    }),
    getGoalLease: vi.fn(async (goalId: string) => {
      const lease = storeState.goalLeases.get(goalId);
      if (!lease) return null;
      if (new Date(lease.leaseExpiresAt).getTime() <= Date.now()) {
        storeState.goalLeases.delete(goalId);
        return null;
      }
      return lease;
    }),
    setGoalLease: vi.fn(async (goalId: string, lease: GoalLeaseRecord) => {
      storeState.goalLeases.set(goalId, lease);
    }),
    clearGoalLease: vi.fn(async (goalId: string) => {
      storeState.goalLeases.delete(goalId);
    }),
    getGoalCheckpoint: vi.fn(async (goalId: string) => (
      storeState.goalCheckpoints.get(goalId) || null
    )),
    setGoalCheckpoint: vi.fn(async (goalId: string, checkpoint: GoalExecutionCheckpoint) => {
      storeState.goalCheckpoints.set(goalId, checkpoint);
    }),
    clearGoalCheckpoint: vi.fn(async (goalId: string) => {
      storeState.goalCheckpoints.delete(goalId);
    }),
    addGoalDlqItem: vi.fn(async (item: GoalDlqItem) => {
      storeState.goalDlqItems.unshift(item);
    }),
    listGoalDlqItems: vi.fn(async (limit: number = 50) => storeState.goalDlqItems.slice(0, limit)),
    removeGoalDlqItem: vi.fn(async (goalId: string) => {
      storeState.goalDlqItems = storeState.goalDlqItems.filter((item) => item.goalId !== goalId);
    }),
    clearGoalDlqItems: vi.fn(async () => {
      storeState.goalDlqItems = [];
    }),
    registerGoalIdempotency: vi.fn(async (record: GoalIdempotencyRecord) => {
      if (storeState.goalIdempotency.has(record.key)) return false;
      storeState.goalIdempotency.set(record.key, record);
      return true;
    }),
    getGoalIdempotency: vi.fn(async (key: string) => (
      storeState.goalIdempotency.get(key) || null
    )),
    clearGoalIdempotency: vi.fn(async (key: string) => {
      storeState.goalIdempotency.delete(key);
    }),
    addGoalLearningEpisode: vi.fn(async (episode: Record<string, unknown>) => {
      storeState.goalLearningEpisodes.unshift(episode);
    }),
    listGoalLearningEpisodes: vi.fn(async (limit: number = 200) => storeState.goalLearningEpisodes.slice(0, limit)),
    clearGoalLearningEpisodes: vi.fn(async () => {
      storeState.goalLearningEpisodes = [];
    }),
  };

  const snapshot: GoalSignalSnapshot = {
    snapshotId: 'snapshot-e2e-1',
    collectedAt: '2026-03-01T05:20:00.000Z',
    chainType: 'thanos',
    sources: ['metrics', 'anomaly', 'policy', 'cost', 'failover', 'memory'],
    metrics: {
      latestCpuUsage: 88,
      latestTxPoolPending: 1200,
      latestGasUsedRatio: 0.83,
      currentVcpu: 2,
      cooldownRemaining: 0,
      cpuTrend: 'rising',
      txPoolTrend: 'rising',
      gasTrend: 'rising',
    },
    anomalies: {
      activeCount: 1,
      criticalCount: 0,
      latestEventTimestamp: '2026-03-01T05:19:00.000Z',
    },
    failover: {
      recentCount: 0,
      latestEventTimestamp: null,
      activeL1RpcUrl: 'https://rpc.sepolia.org',
    },
    cost: {
      avgVcpu: 2.5,
      peakVcpu: 4,
      avgUtilization: 50,
      dataPointCount: 72,
    },
    memory: {
      recentEntryCount: 5,
      recentIncidentCount: 1,
      recentHighSeverityCount: 0,
      latestEntryTimestamp: '2026-03-01T04:50:00.000Z',
    },
    policy: {
      readOnlyMode: false,
      autoScalingEnabled: true,
    },
  };

  return {
    storeState,
    mockStore,
    baseSnapshot: snapshot,
    signalCollectorMock: {
      collectGoalSignalSnapshot: vi.fn(async () => snapshot),
    },
    goalPlannerMock: {
      planAndExecuteGoal: vi.fn().mockResolvedValue({
        plan: {
          planId: 'plan-e2e-1',
          goal: 'goal',
          intent: 'stabilize',
          planVersion: 'v1-rule',
          replanCount: 0,
          failureReasonCode: 'none',
          status: 'completed',
          dryRun: true,
          createdAt: '2026-03-01T05:21:00.000Z',
          updatedAt: '2026-03-01T05:21:00.000Z',
          summary: 'ok',
          steps: [],
        },
        executionLog: [],
      }),
    },
    policyEngineMock: {
      evaluateGoalExecutionPolicy: vi.fn().mockReturnValue({
        decision: 'allow',
        reasonCode: 'none',
        message: 'ok',
      }),
    },
  };
});

vi.mock('@/lib/redis-store', () => ({
  getStore: () => hoisted.mockStore,
}));

vi.mock('@/lib/goal-signal-collector', () => ({
  collectGoalSignalSnapshot: hoisted.signalCollectorMock.collectGoalSignalSnapshot,
}));

vi.mock('@/lib/goal-planner', () => ({
  planAndExecuteGoal: hoisted.goalPlannerMock.planAndExecuteGoal,
}));

vi.mock('@/lib/policy-engine', () => ({
  evaluateGoalExecutionPolicy: hoisted.policyEngineMock.evaluateGoalExecutionPolicy,
}));

describe('goal-manager e2e flow', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...envBackup };

    process.env.GOAL_MANAGER_ENABLED = 'true';
    process.env.GOAL_MANAGER_DISPATCH_ENABLED = 'true';
    process.env.GOAL_CANDIDATE_LLM_ENABLED = 'false';

    hoisted.storeState.candidates = [];
    hoisted.storeState.queue = [];
    hoisted.storeState.suppression = [];
    hoisted.storeState.activeGoalId = null;
    hoisted.storeState.goalLeases = new Map();
    hoisted.storeState.goalCheckpoints = new Map();
    hoisted.storeState.goalDlqItems = [];
    hoisted.storeState.goalIdempotency = new Map();
    hoisted.storeState.goalLearningEpisodes = [];
  });

  it('should execute end-to-end flow from signal to dispatch completion', async () => {
    const tick = await tickGoalManager(new Date('2026-03-01T05:21:00.000Z').getTime());

    expect(tick.enabled).toBe(true);
    expect(tick.generatedCount).toBeGreaterThan(0);
    expect(tick.queuedCount).toBe(1);
    expect(tick.suppressedCount).toBe(0);
    expect(hoisted.storeState.queue).toHaveLength(1);

    const dispatch = await dispatchTopGoal({
      initiatedBy: 'scheduler',
      dryRun: true,
      allowWrites: false,
      now: new Date('2026-03-01T05:21:30.000Z').getTime(),
    });

    const queueItem = hoisted.storeState.queue[0];
    expect(dispatch.dispatched).toBe(true);
    expect(dispatch.status).toBe('completed');
    expect(queueItem?.status).toBe('completed');
    expect(queueItem?.planId).toBe('plan-e2e-1');
    expect(hoisted.goalPlannerMock.planAndExecuteGoal).toHaveBeenCalledTimes(1);
  });

  it('should suppress duplicate candidate using recent candidate history', async () => {
    const firstTick = await tickGoalManager(new Date('2026-03-01T05:21:00.000Z').getTime());
    expect(firstTick.queuedCount).toBe(1);

    const firstCandidate = hoisted.storeState.candidates[0];
    if (!firstCandidate) {
      throw new Error('expected first candidate to exist');
    }

    hoisted.storeState.queue = [];
    hoisted.storeState.suppression = [];
    hoisted.storeState.candidates = [
      {
        ...firstCandidate,
        id: 'recent-1',
        status: 'queued',
        createdAt: '2026-03-01T05:20:40.000Z',
        updatedAt: '2026-03-01T05:20:40.000Z',
      },
    ];

    const tick = await tickGoalManager(new Date('2026-03-01T05:21:30.000Z').getTime());

    expect(tick.generatedCount).toBeGreaterThan(0);
    expect(tick.queuedCount).toBe(0);
    expect(tick.suppressedCount).toBeGreaterThan(0);
    expect(hoisted.storeState.suppression.length).toBeGreaterThan(0);
    expect(hoisted.storeState.suppression[0]?.reasonCode).toBe('duplicate_goal');
  });

  it('should suppress candidate as stale_signal when snapshot is too old', async () => {
    hoisted.signalCollectorMock.collectGoalSignalSnapshot.mockResolvedValueOnce({
      ...hoisted.baseSnapshot,
      collectedAt: '2026-03-01T02:00:00.000Z',
    });

    const tick = await tickGoalManager(new Date('2026-03-01T05:21:00.000Z').getTime());

    expect(tick.queuedCount).toBe(0);
    expect(tick.suppressedCount).toBeGreaterThan(0);
    expect(hoisted.storeState.suppression[0]?.reasonCode).toBe('stale_signal');
  });

  it('should suppress stabilize candidate as cooldown_active during cooldown window', async () => {
    hoisted.signalCollectorMock.collectGoalSignalSnapshot.mockResolvedValueOnce({
      ...hoisted.baseSnapshot,
      metrics: {
        ...hoisted.baseSnapshot.metrics,
        cooldownRemaining: 180,
      },
    });

    const tick = await tickGoalManager(new Date('2026-03-01T05:21:00.000Z').getTime());

    expect(tick.queuedCount).toBe(0);
    expect(tick.suppressedCount).toBeGreaterThan(0);
    expect(hoisted.storeState.suppression[0]?.reasonCode).toBe('cooldown_active');
  });

  it('should suppress write-like stabilize goal as policy_blocked in read-only mode', async () => {
    hoisted.signalCollectorMock.collectGoalSignalSnapshot.mockResolvedValueOnce({
      ...hoisted.baseSnapshot,
      policy: {
        ...hoisted.baseSnapshot.policy,
        readOnlyMode: true,
      },
    });

    const tick = await tickGoalManager(new Date('2026-03-01T05:21:00.000Z').getTime());

    expect(tick.queuedCount).toBe(0);
    expect(tick.suppressedCount).toBeGreaterThan(0);
    expect(hoisted.storeState.suppression[0]?.reasonCode).toBe('policy_blocked');
  });
});
