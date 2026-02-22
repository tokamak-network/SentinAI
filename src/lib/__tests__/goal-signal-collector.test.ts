import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectGoalSignalSnapshot } from '@/lib/goal-signal-collector';

const mockGetRecentMetrics = vi.fn();
const mockGetEvents = vi.fn();
const mockGetFailoverEvents = vi.fn();
const mockGetSentinaiL1RpcUrl = vi.fn();
const mockGetUsageSummary = vi.fn();
const mockQueryAgentMemory = vi.fn();
const mockGetScalingState = vi.fn();
const mockGetChainPlugin = vi.fn();

vi.mock('@/lib/metrics-store', () => ({
  getRecentMetrics: (...args: unknown[]) => mockGetRecentMetrics(...args),
}));

vi.mock('@/lib/anomaly-event-store', () => ({
  getEvents: (...args: unknown[]) => mockGetEvents(...args),
}));

vi.mock('@/lib/l1-rpc-failover', () => ({
  getFailoverEvents: (...args: unknown[]) => mockGetFailoverEvents(...args),
  getSentinaiL1RpcUrl: (...args: unknown[]) => mockGetSentinaiL1RpcUrl(...args),
}));

vi.mock('@/lib/usage-tracker', () => ({
  getUsageSummary: (...args: unknown[]) => mockGetUsageSummary(...args),
}));

vi.mock('@/lib/agent-memory', () => ({
  queryAgentMemory: (...args: unknown[]) => mockQueryAgentMemory(...args),
}));

vi.mock('@/lib/k8s-scaler', () => ({
  getScalingState: (...args: unknown[]) => mockGetScalingState(...args),
}));

vi.mock('@/chains', () => ({
  getChainPlugin: (...args: unknown[]) => mockGetChainPlugin(...args),
}));

describe('goal-signal-collector', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetChainPlugin.mockReturnValue({ chainType: 'thanos' });
    mockGetRecentMetrics.mockResolvedValue([
      {
        timestamp: '2026-02-22T10:01:00.000Z',
        cpuUsage: 30,
        txPoolPending: 200,
        gasUsedRatio: 0.4,
      },
      {
        timestamp: '2026-02-22T10:03:00.000Z',
        cpuUsage: 56,
        txPoolPending: 360,
        gasUsedRatio: 0.62,
      },
      {
        timestamp: '2026-02-22T10:02:00.000Z',
        cpuUsage: 42,
        txPoolPending: 280,
        gasUsedRatio: 0.51,
      },
    ]);
    mockGetEvents.mockResolvedValue({
      total: 2,
      activeCount: 1,
      events: [
        {
          id: 'evt-active',
          timestamp: new Date('2026-02-22T09:58:00.000Z').getTime(),
          status: 'active',
          anomalies: [{ zScore: 5.2 }],
          alerts: [],
        },
        {
          id: 'evt-resolved',
          timestamp: new Date('2026-02-22T09:20:00.000Z').getTime(),
          status: 'resolved',
          anomalies: [{ zScore: 1.2 }],
          alerts: [],
        },
      ],
    });
    mockGetFailoverEvents.mockResolvedValue([
      { timestamp: '2026-02-22T09:45:00.000Z' },
      { timestamp: '2026-02-22T08:10:00.000Z' },
    ]);
    mockGetSentinaiL1RpcUrl.mockResolvedValue('https://ethereum-sepolia-rpc.publicnode.com');
    mockGetUsageSummary.mockResolvedValue({
      avgVcpu: 2.25,
      peakVcpu: 4,
      avgUtilization: 48.7,
      dataPointCount: 144,
      oldestDataAge: 12,
    });
    mockQueryAgentMemory.mockResolvedValue([
      {
        id: 'mem-1',
        timestamp: '2026-02-22T09:59:00.000Z',
        category: 'incident',
        chainType: 'thanos',
        summary: 'incident trace',
        severity: 'high',
      },
      {
        id: 'mem-2',
        timestamp: '2026-02-22T09:30:00.000Z',
        category: 'analysis',
        chainType: 'thanos',
        summary: 'analysis trace',
        severity: 'low',
      },
    ]);
    mockGetScalingState.mockResolvedValue({
      currentVcpu: 2,
      currentMemoryGiB: 4,
      lastScalingTime: null,
      lastDecision: null,
      cooldownRemaining: 180,
      autoScalingEnabled: true,
    });
    process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE = 'false';
  });

  it('should collect normalized snapshot from multi-source signals', async () => {
    const snapshot = await collectGoalSignalSnapshot({
      now: new Date('2026-02-22T10:05:00.000Z').getTime(),
      failoverLookbackMinutes: 30,
    });

    expect(snapshot.chainType).toBe('thanos');
    expect(snapshot.sources).toEqual(['metrics', 'anomaly', 'policy', 'cost', 'failover', 'memory']);

    expect(snapshot.metrics.latestCpuUsage).toBe(56);
    expect(snapshot.metrics.latestTxPoolPending).toBe(360);
    expect(snapshot.metrics.latestGasUsedRatio).toBe(0.62);
    expect(snapshot.metrics.cpuTrend).toBe('rising');
    expect(snapshot.metrics.txPoolTrend).toBe('rising');
    expect(snapshot.metrics.gasTrend).toBe('rising');
    expect(snapshot.metrics.currentVcpu).toBe(2);
    expect(snapshot.metrics.cooldownRemaining).toBe(180);

    expect(snapshot.anomalies.activeCount).toBe(1);
    expect(snapshot.anomalies.criticalCount).toBe(1);
    expect(snapshot.anomalies.latestEventTimestamp).toBe('2026-02-22T09:58:00.000Z');

    expect(snapshot.failover.recentCount).toBe(1);
    expect(snapshot.failover.activeL1RpcUrl).toContain('sepolia');
    expect(snapshot.failover.latestEventTimestamp).toBe('2026-02-22T09:45:00.000Z');

    expect(snapshot.cost.avgVcpu).toBe(2.25);
    expect(snapshot.cost.peakVcpu).toBe(4);
    expect(snapshot.cost.avgUtilization).toBe(48.7);
    expect(snapshot.cost.dataPointCount).toBe(144);

    expect(snapshot.memory.recentEntryCount).toBe(2);
    expect(snapshot.memory.recentIncidentCount).toBe(1);
    expect(snapshot.memory.recentHighSeverityCount).toBe(1);
    expect(snapshot.memory.latestEntryTimestamp).toBe('2026-02-22T09:59:00.000Z');

    expect(snapshot.policy.readOnlyMode).toBe(false);
    expect(snapshot.policy.autoScalingEnabled).toBe(true);
    expect(snapshot.snapshotId).toHaveLength(24);
  });

  it('should produce deterministic snapshotId for same input state', async () => {
    const now = new Date('2026-02-22T10:05:00.000Z').getTime();
    const first = await collectGoalSignalSnapshot({ now });
    const second = await collectGoalSignalSnapshot({ now });

    expect(first.snapshotId).toBe(second.snapshotId);
    expect(first).toEqual(second);
  });

  it('should fallback safely when source collectors fail', async () => {
    mockGetRecentMetrics.mockRejectedValue(new Error('metrics down'));
    mockGetEvents.mockRejectedValue(new Error('anomaly down'));
    mockGetFailoverEvents.mockRejectedValue(new Error('failover down'));
    mockGetUsageSummary.mockRejectedValue(new Error('usage down'));
    mockQueryAgentMemory.mockRejectedValue(new Error('memory down'));
    mockGetScalingState.mockRejectedValue(new Error('scaling down'));
    mockGetSentinaiL1RpcUrl.mockRejectedValue(new Error('l1 down'));
    process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE = 'true';

    const snapshot = await collectGoalSignalSnapshot({
      now: new Date('2026-02-22T10:05:00.000Z').getTime(),
    });

    expect(snapshot.metrics.latestCpuUsage).toBeNull();
    expect(snapshot.metrics.currentVcpu).toBe(1);
    expect(snapshot.metrics.cooldownRemaining).toBe(0);
    expect(snapshot.anomalies.activeCount).toBe(0);
    expect(snapshot.failover.recentCount).toBe(0);
    expect(snapshot.failover.activeL1RpcUrl).toBe('');
    expect(snapshot.cost.dataPointCount).toBe(0);
    expect(snapshot.memory.recentEntryCount).toBe(0);
    expect(snapshot.policy.readOnlyMode).toBe(true);
    expect(snapshot.policy.autoScalingEnabled).toBe(true);
  });
});
