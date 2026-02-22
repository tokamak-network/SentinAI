import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchTopGoal,
  getGoalManagerConfig,
  tickGoalManager,
} from '@/lib/goal-manager';
import type {
  AutonomousGoalCandidate,
  AutonomousGoalQueueItem,
  GoalSignalSnapshot,
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
    activeGoalId: null,
    goalLeases: new Map(),
    goalCheckpoints: new Map(),
    goalDlqItems: [],
    goalIdempotency: new Map(),
    goalLearningEpisodes: [],
  };

  const mockStore = {
    addAutonomousGoalCandidate: vi.fn(async (candidate: AutonomousGoalCandidate) => {
      storeState.candidates.unshift(candidate);
    }),
    listAutonomousGoalCandidates: vi.fn(async (limit: number = 50) => storeState.candidates.slice(0, limit)),
    getAutonomousGoalQueue: vi.fn(async (limit: number = 50) => storeState.queue.slice(0, limit)),
    getAutonomousGoalQueueItem: vi.fn(async (goalId: string) => (
      storeState.queue.find((item) => item.goalId === goalId) || null
    )),
    upsertAutonomousGoalQueueItem: vi.fn(async (item: AutonomousGoalQueueItem) => {
      storeState.queue = storeState.queue.filter((entry) => entry.goalId !== item.goalId);
      storeState.queue.push(item);
      storeState.queue.sort((a, b) => b.score.total - a.score.total);
    }),
    setActiveAutonomousGoalId: vi.fn(async (goalId: string | null) => {
      storeState.activeGoalId = goalId;
    }),
    getActiveAutonomousGoalId: vi.fn(async () => storeState.activeGoalId),
    listGoalSuppressionRecords: vi.fn(async () => []),
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

  return {
    storeState,
    mockStore,
    signalCollectorMock: {
      collectGoalSignalSnapshot: vi.fn(),
    },
    candidateGeneratorMock: {
      generateAutonomousGoalCandidates: vi.fn(),
    },
    priorityEngineMock: {
      prioritizeGoalCandidates: vi.fn(),
      persistSuppressionRecords: vi.fn(),
    },
    goalPlannerMock: {
      planAndExecuteGoal: vi.fn(),
    },
    policyEngineMock: {
      evaluateGoalExecutionPolicy: vi.fn(),
    },
  };
});

vi.mock('@/lib/redis-store', () => ({
  getStore: () => hoisted.mockStore,
}));

vi.mock('@/lib/goal-signal-collector', () => ({
  collectGoalSignalSnapshot: hoisted.signalCollectorMock.collectGoalSignalSnapshot,
}));

vi.mock('@/lib/goal-candidate-generator', () => ({
  generateAutonomousGoalCandidates: hoisted.candidateGeneratorMock.generateAutonomousGoalCandidates,
}));

vi.mock('@/lib/goal-priority-engine', () => ({
  prioritizeGoalCandidates: hoisted.priorityEngineMock.prioritizeGoalCandidates,
  persistSuppressionRecords: hoisted.priorityEngineMock.persistSuppressionRecords,
}));

vi.mock('@/lib/goal-planner', () => ({
  planAndExecuteGoal: hoisted.goalPlannerMock.planAndExecuteGoal,
}));

vi.mock('@/lib/policy-engine', () => ({
  evaluateGoalExecutionPolicy: hoisted.policyEngineMock.evaluateGoalExecutionPolicy,
}));

function createSnapshot(): GoalSignalSnapshot {
  return {
    snapshotId: 'snapshot-1',
    collectedAt: '2026-02-22T12:00:00.000Z',
    chainType: 'thanos',
    sources: ['metrics', 'anomaly', 'policy', 'cost', 'failover', 'memory'],
    metrics: {
      latestCpuUsage: 82,
      latestTxPoolPending: 1100,
      latestGasUsedRatio: 0.8,
      currentVcpu: 2,
      cooldownRemaining: 0,
      cpuTrend: 'rising',
      txPoolTrend: 'rising',
      gasTrend: 'rising',
    },
    anomalies: {
      activeCount: 1,
      criticalCount: 0,
      latestEventTimestamp: '2026-02-22T11:58:00.000Z',
    },
    failover: {
      recentCount: 0,
      latestEventTimestamp: null,
      activeL1RpcUrl: 'https://rpc.sepolia.org',
    },
    cost: {
      avgVcpu: 2.3,
      peakVcpu: 4,
      avgUtilization: 52,
      dataPointCount: 120,
    },
    memory: {
      recentEntryCount: 2,
      recentIncidentCount: 1,
      recentHighSeverityCount: 0,
      latestEntryTimestamp: '2026-02-22T11:50:00.000Z',
    },
    policy: {
      readOnlyMode: false,
      autoScalingEnabled: true,
    },
  };
}

function createCandidate(id: string): AutonomousGoalCandidate {
  return {
    id,
    createdAt: '2026-02-22T12:00:00.000Z',
    updatedAt: '2026-02-22T12:00:00.000Z',
    source: 'anomaly',
    status: 'candidate',
    goal: `goal-${id}`,
    intent: 'stabilize',
    risk: 'high',
    confidence: 0.82,
    signature: `sig-${id}`,
    rationale: 'reason',
    signalSnapshotId: 'snapshot-1',
  };
}

describe('goal-manager', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...envBackup };
    delete process.env.GOAL_MANAGER_ENABLED;
    delete process.env.GOAL_MANAGER_DISPATCH_ENABLED;
    delete process.env.GOAL_MANAGER_DISPATCH_DRY_RUN;
    delete process.env.GOAL_MANAGER_DISPATCH_ALLOW_WRITES;
    delete process.env.GOAL_CANDIDATE_LLM_ENABLED;

    hoisted.storeState.candidates = [];
    hoisted.storeState.queue = [];
    hoisted.storeState.activeGoalId = null;
    hoisted.storeState.goalLeases = new Map();
    hoisted.storeState.goalCheckpoints = new Map();
    hoisted.storeState.goalDlqItems = [];
    hoisted.storeState.goalIdempotency = new Map();
    hoisted.storeState.goalLearningEpisodes = [];

    hoisted.signalCollectorMock.collectGoalSignalSnapshot.mockResolvedValue(createSnapshot());
    hoisted.candidateGeneratorMock.generateAutonomousGoalCandidates.mockResolvedValue({
      candidates: [createCandidate('c1')],
      llmEnhanced: false,
    });
    hoisted.priorityEngineMock.prioritizeGoalCandidates.mockReturnValue({
      queued: [
        {
          goalId: 'goal-1',
          candidateId: 'c1',
          enqueuedAt: '2026-02-22T12:00:00.000Z',
          attempts: 0,
          status: 'queued',
          goal: 'goal-c1',
          intent: 'stabilize',
          source: 'anomaly',
          risk: 'high',
          confidence: 0.82,
          signature: 'sig-c1',
          score: { impact: 30, urgency: 15, confidence: 16, policyFit: 10, total: 71 },
        },
      ],
      suppressed: [],
    });
    hoisted.priorityEngineMock.persistSuppressionRecords.mockResolvedValue(undefined);
    hoisted.policyEngineMock.evaluateGoalExecutionPolicy.mockReturnValue({
      decision: 'allow',
      reasonCode: 'none',
      message: 'ok',
    });
    hoisted.goalPlannerMock.planAndExecuteGoal.mockResolvedValue({
      plan: {
        planId: 'plan-1',
        goal: 'goal-c1',
        intent: 'stabilize',
        planVersion: 'v1-rule',
        replanCount: 0,
        failureReasonCode: 'none',
        status: 'completed',
        dryRun: true,
        createdAt: '2026-02-22T12:00:00.000Z',
        updatedAt: '2026-02-22T12:00:00.000Z',
        summary: 'ok',
        steps: [],
      },
      executionLog: [],
    });
  });

  it('should return disabled config by default', () => {
    const config = getGoalManagerConfig();
    expect(config.enabled).toBe(false);
    expect(config.dispatchEnabled).toBe(false);
  });

  it('should skip tick when goal manager is disabled', async () => {
    const result = await tickGoalManager();
    expect(result.enabled).toBe(false);
    expect(result.generatedCount).toBe(0);
    expect(hoisted.signalCollectorMock.collectGoalSignalSnapshot).not.toHaveBeenCalled();
  });

  it('should collect, prioritize, and enqueue goals on tick', async () => {
    process.env.GOAL_MANAGER_ENABLED = 'true';

    const result = await tickGoalManager(new Date('2026-02-22T12:00:00.000Z').getTime());

    expect(result.enabled).toBe(true);
    expect(result.generatedCount).toBe(1);
    expect(result.queuedCount).toBe(1);
    expect(hoisted.storeState.queue).toHaveLength(1);
    expect(hoisted.storeState.candidates).toHaveLength(1);
  });

  it('should return queue_empty when no queued goal exists', async () => {
    process.env.GOAL_MANAGER_ENABLED = 'true';
    process.env.GOAL_MANAGER_DISPATCH_ENABLED = 'true';

    const result = await dispatchTopGoal({ initiatedBy: 'scheduler' });
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('queue_empty');
  });

  it('should dispatch and mark goal completed', async () => {
    process.env.GOAL_MANAGER_ENABLED = 'true';
    process.env.GOAL_MANAGER_DISPATCH_ENABLED = 'true';
    hoisted.storeState.queue = [
      {
        goalId: 'goal-1',
        candidateId: 'c1',
        enqueuedAt: '2026-02-22T12:00:00.000Z',
        attempts: 0,
        status: 'queued',
        goal: 'goal-c1',
        intent: 'stabilize',
        source: 'anomaly',
        risk: 'high',
        confidence: 0.82,
        signature: 'sig-c1',
        score: { impact: 30, urgency: 15, confidence: 16, policyFit: 10, total: 71 },
      },
    ];

    const result = await dispatchTopGoal({ initiatedBy: 'scheduler', dryRun: true, allowWrites: false });
    const updated = hoisted.storeState.queue.find((item) => item.goalId === 'goal-1');

    expect(result.dispatched).toBe(true);
    expect(result.status).toBe('completed');
    expect(updated?.status).toBe('completed');
    expect(updated?.planId).toBe('plan-1');
    expect(hoisted.goalPlannerMock.planAndExecuteGoal).toHaveBeenCalled();
  });

  it('should fail dispatch when policy denies execution', async () => {
    process.env.GOAL_MANAGER_ENABLED = 'true';
    process.env.GOAL_MANAGER_DISPATCH_ENABLED = 'true';
    hoisted.storeState.queue = [
      {
        goalId: 'goal-1',
        candidateId: 'c1',
        enqueuedAt: '2026-02-22T12:00:00.000Z',
        attempts: 0,
        status: 'queued',
        goal: 'goal-c1',
        intent: 'stabilize',
        source: 'anomaly',
        risk: 'high',
        confidence: 0.82,
        signature: 'sig-c1',
        score: { impact: 30, urgency: 15, confidence: 16, policyFit: 10, total: 71 },
      },
    ];
    hoisted.policyEngineMock.evaluateGoalExecutionPolicy.mockReturnValue({
      decision: 'deny',
      reasonCode: 'read_only_write_blocked',
      message: 'blocked by policy',
    });

    const result = await dispatchTopGoal({ initiatedBy: 'scheduler', dryRun: false, allowWrites: true });
    const updated = hoisted.storeState.queue.find((item) => item.goalId === 'goal-1');

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('read_only_write_blocked');
    expect(updated?.status).toBe('failed');
  });

  it('should requeue failed goal with backoff when retries remain', async () => {
    process.env.GOAL_MANAGER_ENABLED = 'true';
    process.env.GOAL_MANAGER_DISPATCH_ENABLED = 'true';
    process.env.GOAL_ORCHESTRATOR_MAX_RETRIES = '2';
    process.env.GOAL_ORCHESTRATOR_BACKOFF_BASE_MS = '1000';

    hoisted.storeState.queue = [
      {
        goalId: 'goal-retry-1',
        candidateId: 'c1',
        enqueuedAt: '2026-02-22T12:00:00.000Z',
        attempts: 0,
        status: 'queued',
        goal: 'goal-c1',
        intent: 'stabilize',
        source: 'anomaly',
        risk: 'high',
        confidence: 0.82,
        signature: 'sig-retry-1',
        score: { impact: 30, urgency: 15, confidence: 16, policyFit: 10, total: 71 },
      },
    ];

    hoisted.goalPlannerMock.planAndExecuteGoal.mockResolvedValueOnce({
      plan: {
        planId: 'plan-retry-1',
        goal: 'goal-c1',
        intent: 'stabilize',
        planVersion: 'v1-rule',
        replanCount: 0,
        failureReasonCode: 'none',
        status: 'failed',
        dryRun: true,
        createdAt: '2026-02-22T12:00:00.000Z',
        updatedAt: '2026-02-22T12:00:00.000Z',
        summary: 'failed',
        steps: [],
      },
      executionLog: [
        {
          stepId: 'step-1',
          action: 'run_rca',
          status: 'failed',
          message: 'rca failed',
          executedAt: '2026-02-22T12:00:01.000Z',
        },
      ],
    });

    const result = await dispatchTopGoal({
      initiatedBy: 'scheduler',
      dryRun: true,
      allowWrites: false,
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
    });

    const updated = hoisted.storeState.queue.find((item) => item.goalId === 'goal-retry-1');
    expect(result.status).toBe('queued');
    expect(result.reason).toBe('requeued');
    expect(updated?.status).toBe('queued');
    expect(updated?.nextAttemptAt).toBeDefined();
    expect(updated?.lastError).toContain('rca failed');
  });

  it('should move failed goal to dlq when max retries exceeded', async () => {
    process.env.GOAL_MANAGER_ENABLED = 'true';
    process.env.GOAL_MANAGER_DISPATCH_ENABLED = 'true';
    process.env.GOAL_ORCHESTRATOR_MAX_RETRIES = '0';

    hoisted.storeState.queue = [
      {
        goalId: 'goal-dlq-1',
        candidateId: 'c1',
        enqueuedAt: '2026-02-22T12:00:00.000Z',
        attempts: 0,
        status: 'queued',
        goal: 'goal-c1',
        intent: 'stabilize',
        source: 'anomaly',
        risk: 'high',
        confidence: 0.82,
        signature: 'sig-dlq-1',
        score: { impact: 30, urgency: 15, confidence: 16, policyFit: 10, total: 71 },
      },
    ];

    hoisted.goalPlannerMock.planAndExecuteGoal.mockResolvedValueOnce({
      plan: {
        planId: 'plan-dlq-1',
        goal: 'goal-c1',
        intent: 'stabilize',
        planVersion: 'v1-rule',
        replanCount: 0,
        failureReasonCode: 'none',
        status: 'failed',
        dryRun: true,
        createdAt: '2026-02-22T12:00:00.000Z',
        updatedAt: '2026-02-22T12:00:00.000Z',
        summary: 'failed',
        steps: [],
      },
      executionLog: [
        {
          stepId: 'step-1',
          action: 'run_rca',
          status: 'failed',
          message: 'fatal failure',
          executedAt: '2026-02-22T12:00:01.000Z',
        },
      ],
    });

    const result = await dispatchTopGoal({
      initiatedBy: 'scheduler',
      dryRun: true,
      allowWrites: false,
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
    });

    const updated = hoisted.storeState.queue.find((item) => item.goalId === 'goal-dlq-1');
    expect(result.status).toBe('dlq');
    expect(updated?.status).toBe('dlq');
    expect(hoisted.storeState.goalDlqItems.length).toBe(1);
    expect(hoisted.storeState.goalDlqItems[0].goalId).toBe('goal-dlq-1');
  });
});
