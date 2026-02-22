import { beforeEach, describe, expect, it, vi } from 'vitest';
import { restartComponent, runHealthDiagnostics } from '@/lib/component-operator';

const hoisted = vi.hoisted(() => ({
  chainMock: {
    getChainPlugin: vi.fn(),
  },
  actionMock: {
    executeAction: vi.fn(),
  },
  metricsMock: {
    getRecentMetrics: vi.fn(),
    getMetricsCount: vi.fn(),
  },
  anomalyMock: {
    getEvents: vi.fn(),
  },
  scalerMock: {
    getScalingState: vi.fn(),
  },
  l1Mock: {
    getSentinaiL1RpcUrl: vi.fn(),
    getL1FailoverState: vi.fn(),
    healthCheckEndpoint: vi.fn(),
    maskUrl: vi.fn((url: string) => url),
  },
}));

vi.mock('@/chains', () => ({
  getChainPlugin: hoisted.chainMock.getChainPlugin,
}));

vi.mock('@/lib/action-executor', () => ({
  executeAction: hoisted.actionMock.executeAction,
}));

vi.mock('@/lib/metrics-store', () => ({
  getRecentMetrics: hoisted.metricsMock.getRecentMetrics,
  getMetricsCount: hoisted.metricsMock.getMetricsCount,
}));

vi.mock('@/lib/anomaly-event-store', () => ({
  getEvents: hoisted.anomalyMock.getEvents,
}));

vi.mock('@/lib/k8s-scaler', () => ({
  getScalingState: hoisted.scalerMock.getScalingState,
}));

vi.mock('@/lib/l1-rpc-failover', () => ({
  getSentinaiL1RpcUrl: hoisted.l1Mock.getSentinaiL1RpcUrl,
  getL1FailoverState: hoisted.l1Mock.getL1FailoverState,
  healthCheckEndpoint: hoisted.l1Mock.healthCheckEndpoint,
  maskUrl: hoisted.l1Mock.maskUrl,
}));

describe('component-operator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.chainMock.getChainPlugin.mockReturnValue({
      primaryExecutionClient: 'op-geth',
      normalizeComponentName: (name: string) => {
        if (name === 'batcher') return 'op-batcher';
        if (name === 'proposer') return 'op-proposer';
        if (name === 'op-geth') return 'op-geth';
        return 'system';
      },
    });
    hoisted.actionMock.executeAction.mockResolvedValue({
      status: 'success',
      output: 'Health check: component is Ready',
    });
    hoisted.metricsMock.getRecentMetrics.mockResolvedValue([
      {
        timestamp: new Date().toISOString(),
        cpuUsage: 45,
        blockHeight: 100,
        blockInterval: 2,
        txPoolPending: 10,
        gasUsedRatio: 0.5,
        currentVcpu: 2,
      },
    ]);
    hoisted.metricsMock.getMetricsCount.mockResolvedValue(1);
    hoisted.anomalyMock.getEvents.mockResolvedValue({
      events: [],
      total: 0,
      activeCount: 0,
    });
    hoisted.scalerMock.getScalingState.mockResolvedValue({
      currentVcpu: 2,
      currentMemoryGiB: 4,
      lastScalingTime: null,
      lastDecision: null,
      cooldownRemaining: 0,
      autoScalingEnabled: true,
    });
    hoisted.l1Mock.getSentinaiL1RpcUrl.mockReturnValue('https://rpc.io');
    hoisted.l1Mock.getL1FailoverState.mockReturnValue({
      endpoints: [{ url: 'https://rpc.io' }],
    });
    hoisted.l1Mock.healthCheckEndpoint.mockResolvedValue(true);
  });

  it('should restart resolved component', async () => {
    const result = await restartComponent({ target: 'batcher', dryRun: false });
    expect(result.success).toBe(true);
    expect(result.target).toBe('op-batcher');
  });

  it('should return dry-run restart result without execution', async () => {
    const result = await restartComponent({ target: 'proposer', dryRun: true });
    expect(result.success).toBe(true);
    expect(result.message).toContain('DRY RUN');
    expect(hoisted.actionMock.executeAction).not.toHaveBeenCalled();
  });

  it('should run health diagnostics summary', async () => {
    const result = await runHealthDiagnostics();
    expect(result.metrics.count).toBe(1);
    expect(result.l1Rpc.healthy).toBe(true);
    expect(result.components.length).toBeGreaterThan(0);
  });
});
