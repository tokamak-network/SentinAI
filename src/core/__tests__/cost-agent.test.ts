import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CostAgent } from '@/core/agents/cost-agent';

// ============================================================
// Mocks
// ============================================================

vi.mock('@/lib/cost-optimizer', () => ({
  generateCostReport: vi.fn().mockResolvedValue({
    currentMonthly: 33.60,
    recommendations: [
      { type: 'downscale', title: 'Downscale', description: 'Downscale during off-peak hours', currentCost: 33.60, projectedCost: 25.10, savingsPercent: 25, confidence: 0.8, implementation: 'auto', risk: 'low' },
    ],
  }),
}));

vi.mock('@/lib/usage-tracker', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
  getUsageSummary: vi.fn().mockResolvedValue({
    avgVcpu: 1.5,
    peakVcpu: 2,
    totalHours: 168,
  }),
}));

vi.mock('@/lib/k8s-scaler', () => ({
  getCurrentVcpu: vi.fn().mockResolvedValue(2),
}));

vi.mock('@/lib/experience-store', () => ({
  recordExperience: vi.fn().mockResolvedValue({
    id: 'exp-1', instanceId: 'inst-1', protocolId: 'opstack',
    timestamp: '2026-03-03T00:00:00.000Z', category: 'cost-optimization',
    trigger: { type: 'cost-analysis', metric: 'monthlyCost', value: 33.60 },
    action: 'cost insight', outcome: 'success', resolutionMs: 10, metricsSnapshot: {},
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

describe('CostAgent', () => {
  let agent: CostAgent;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    const costMod = await import('@/lib/cost-optimizer');
    (costMod.generateCostReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentMonthly: 33.60,
      recommendations: [
        { type: 'downscale', title: 'Downscale', description: 'Downscale during off-peak hours', currentCost: 33.60, projectedCost: 25.10, savingsPercent: 25, confidence: 0.8, implementation: 'auto', risk: 'low' },
      ],
    });

    const usageMod = await import('@/lib/usage-tracker');
    (usageMod.getUsageSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      avgVcpu: 1.5, peakVcpu: 2, totalHours: 168,
    });

    const k8sMod = await import('@/lib/k8s-scaler');
    (k8sMod.getCurrentVcpu as ReturnType<typeof vi.fn>).mockResolvedValue(2);

    agent = new CostAgent({ instanceId: 'inst-1', protocolId: 'opstack', intervalMs: 50 });
  });

  afterEach(() => {
    agent.stop();
    vi.useRealTimers();
  });

  it('should have domain = cost', () => {
    expect(agent.domain).toBe('cost');
  });

  it('should default interval to 300s', () => {
    const defaultAgent = new CostAgent({ instanceId: 'inst-2', protocolId: 'opstack' });
    expect(defaultAgent.getIntervalMs()).toBe(300_000);
  });

  it('should emit cost-insight when recommendations have savings', async () => {
    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cost-insight',
        payload: expect.objectContaining({
          insights: expect.arrayContaining([
            expect.objectContaining({ type: 'cost-savings' }),
          ]),
          totalPotentialSavingsUsd: expect.any(Number),
        }),
      })
    );
  });

  it('should not emit when no savings available', async () => {
    const costMod = await import('@/lib/cost-optimizer');
    (costMod.generateCostReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentMonthly: 33.60,
      recommendations: [],
    });

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).not.toHaveBeenCalled();
  });

  it('should detect overprovisioning', async () => {
    const costMod = await import('@/lib/cost-optimizer');
    (costMod.generateCostReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentMonthly: 67.20,
      recommendations: [],
    });

    const usageMod = await import('@/lib/usage-tracker');
    (usageMod.getUsageSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      avgVcpu: 4, peakVcpu: 2, totalHours: 168,
    });

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cost-insight',
        payload: expect.objectContaining({
          insights: expect.arrayContaining([
            expect.objectContaining({ type: 'overprovision' }),
          ]),
        }),
      })
    );
  });

  it('should record usage on each tick', async () => {
    const { recordUsage } = await import('@/lib/usage-tracker');

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(recordUsage).toHaveBeenCalledWith(2, 0);
  });

  it('should survive cost report failure gracefully', async () => {
    const costMod = await import('@/lib/cost-optimizer');
    (costMod.generateCostReport as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('No data'));

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(agent.isRunning()).toBe(true);
  });

  it('should record experience when insights found', async () => {
    const { recordExperience } = await import('@/lib/experience-store');

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(recordExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'cost-optimization',
        trigger: expect.objectContaining({ type: 'cost-analysis' }),
      })
    );
  });
});
