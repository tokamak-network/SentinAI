import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SecurityAgent } from '@/core/agents/security-agent';

// ============================================================
// Mocks
// ============================================================

vi.mock('@/lib/eoa-balance-monitor', () => ({
  getAllBalanceStatus: vi.fn().mockResolvedValue({
    roles: {
      batcher: { balanceEth: 0.05, level: 'critical', role: 'batcher', address: '0x1', timestamp: '' },
      proposer: { balanceEth: 1.5, level: 'healthy', role: 'proposer', address: '0x2', timestamp: '' },
    },
    batcher: { balanceEth: 0.05, level: 'critical', role: 'batcher', address: '0x1', timestamp: '' },
    proposer: { balanceEth: 1.5, level: 'healthy', role: 'proposer', address: '0x2', timestamp: '' },
    challenger: null,
    treasury: null,
    dailyRefillTotalEth: 0,
  }),
}));

vi.mock('@/core/instance-metrics-store', () => ({
  getRecentMetrics: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/experience-store', () => ({
  recordExperience: vi.fn().mockResolvedValue({
    id: 'exp-1', instanceId: 'inst-1', protocolId: 'opstack',
    timestamp: '2026-03-03T00:00:00.000Z', category: 'security-alert',
    trigger: { type: 'eoa-balance', metric: 'batcher_balance', value: 0.05 },
    action: 'security alert', outcome: 'success', resolutionMs: 10, metricsSnapshot: {},
  }),
}));

const mockBusEmit = vi.fn();
vi.mock('@/core/agent-event-bus', () => ({
  getAgentEventBus: () => ({
    emit: mockBusEmit,
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// ============================================================
// Tests
// ============================================================

describe('SecurityAgent', () => {
  let agent: SecurityAgent;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Restore default mocks
    const eoaMod = await import('@/lib/eoa-balance-monitor');
    (eoaMod.getAllBalanceStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      roles: {
        batcher: { balanceEth: 0.05, level: 'critical', role: 'batcher', address: '0x1', timestamp: '' },
        proposer: { balanceEth: 1.5, level: 'healthy', role: 'proposer', address: '0x2', timestamp: '' },
      },
      batcher: { balanceEth: 0.05, level: 'critical', role: 'batcher', address: '0x1', timestamp: '' },
      proposer: { balanceEth: 1.5, level: 'healthy', role: 'proposer', address: '0x2', timestamp: '' },
      challenger: null,
      treasury: null,
      dailyRefillTotalEth: 0,
    });

    const metricsMod = await import('@/core/instance-metrics-store');
    (metricsMod.getRecentMetrics as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    agent = new SecurityAgent({ instanceId: 'inst-1', protocolId: 'opstack', intervalMs: 50 });
  });

  afterEach(() => {
    agent.stop();
    vi.useRealTimers();
  });

  it('should have domain = security', () => {
    expect(agent.domain).toBe('security');
  });

  it('should default interval to 60s', () => {
    const defaultAgent = new SecurityAgent({ instanceId: 'inst-2', protocolId: 'opstack' });
    expect(defaultAgent.getIntervalMs()).toBe(60_000);
  });

  it('should emit security-alert for critical EOA balance', async () => {
    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'security-alert',
        payload: expect.objectContaining({
          alertCount: 1,
          alerts: expect.arrayContaining([
            expect.objectContaining({ type: 'eoa-balance', metric: 'batcher_balance' }),
          ]),
        }),
      })
    );
  });

  it('should not emit when all balances are healthy', async () => {
    const eoaMod = await import('@/lib/eoa-balance-monitor');
    (eoaMod.getAllBalanceStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      roles: {
        batcher: { balanceEth: 5.0, level: 'healthy', role: 'batcher', address: '0x1', timestamp: '' },
      },
      batcher: { balanceEth: 5.0, level: 'healthy', role: 'batcher', address: '0x1', timestamp: '' },
      proposer: null, challenger: null, treasury: null, dailyRefillTotalEth: 0,
    });

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).not.toHaveBeenCalled();
  });

  it('should detect gas spike anomaly', async () => {
    const metricsMod = await import('@/core/instance-metrics-store');
    const eoaMod = await import('@/lib/eoa-balance-monitor');

    // No EOA issues
    (eoaMod.getAllBalanceStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      roles: {}, batcher: null, proposer: null, challenger: null, treasury: null, dailyRefillTotalEth: 0,
    });

    // Gas spike: last value is 4x average
    const points = Array.from({ length: 10 }, (_, i) => ({
      instanceId: 'inst-1',
      timestamp: new Date(Date.now() - (10 - i) * 5000).toISOString(),
      fields: { gasUsedRatio: i < 9 ? 0.1 : 0.4, txPoolPending: 50 },
    }));
    (metricsMod.getRecentMetrics as ReturnType<typeof vi.fn>).mockResolvedValue(points);

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'security-alert',
        payload: expect.objectContaining({
          alerts: expect.arrayContaining([
            expect.objectContaining({ type: 'gas-spike' }),
          ]),
        }),
      })
    );
  });

  it('should detect tx pool surge', async () => {
    const metricsMod = await import('@/core/instance-metrics-store');
    const eoaMod = await import('@/lib/eoa-balance-monitor');

    (eoaMod.getAllBalanceStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      roles: {}, batcher: null, proposer: null, challenger: null, treasury: null, dailyRefillTotalEth: 0,
    });

    // TX pool surge: last value is 10x average
    const points = Array.from({ length: 10 }, (_, i) => ({
      instanceId: 'inst-1',
      timestamp: new Date(Date.now() - (10 - i) * 5000).toISOString(),
      fields: { gasUsedRatio: 0.1, txPoolPending: i < 9 ? 20 : 200 },
    }));
    (metricsMod.getRecentMetrics as ReturnType<typeof vi.fn>).mockResolvedValue(points);

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'security-alert',
        payload: expect.objectContaining({
          alerts: expect.arrayContaining([
            expect.objectContaining({ type: 'tx-pool-surge' }),
          ]),
        }),
      })
    );
  });

  it('should survive EOA monitor failure gracefully', async () => {
    const eoaMod = await import('@/lib/eoa-balance-monitor');
    (eoaMod.getAllBalanceStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('No L1 RPC'));

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(agent.isRunning()).toBe(true);
  });

  it('should record experience for each alert', async () => {
    const { recordExperience } = await import('@/lib/experience-store');

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(recordExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'security-alert',
        trigger: expect.objectContaining({ type: 'eoa-balance' }),
      })
    );
  });
});
