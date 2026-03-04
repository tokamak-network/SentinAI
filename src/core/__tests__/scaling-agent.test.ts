import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScalingAgent } from '@/core/agents/scaling-agent';

// ============================================================
// Mocks
// ============================================================

vi.mock('@/core/instance-metrics-store', () => ({
  getRecentMetrics: vi.fn().mockResolvedValue([{
    instanceId: 'inst-1',
    timestamp: '2026-03-03T00:00:00.000Z',
    fields: { cpuUsage: 60, txPoolPending: 50, gasUsedRatio: 0.5 },
  }]),
}));

vi.mock('@/lib/scaling-decision', () => ({
  makeScalingDecision: vi.fn().mockReturnValue({
    score: 55,
    tier: 'Normal',
    targetVcpu: 2,
    targetMemoryGiB: 4,
    reason: 'Normal load',
    breakdown: { cpu: 18, gas: 15, txPool: 10, ai: 12 },
  }),
}));

vi.mock('@/lib/predictive-scaler', () => ({
  predictScaling: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/k8s-scaler', () => ({
  getCurrentVcpu: vi.fn().mockResolvedValue(1),
  isAutoScalingEnabled: vi.fn().mockResolvedValue(true),
  checkCooldown: vi.fn().mockResolvedValue({ inCooldown: false, remainingSeconds: 0 }),
}));

vi.mock('@/lib/experience-store', () => ({
  recordExperience: vi.fn().mockResolvedValue({
    id: 'exp-1',
    instanceId: 'inst-1',
    protocolId: 'opstack',
    timestamp: '2026-03-03T00:00:00.000Z',
    category: 'scaling-action',
    trigger: { type: 'scaling-score', metric: 'compositeScore', value: 55 },
    action: 'recommend 1→2 vCPU',
    outcome: 'success',
    resolutionMs: 10,
    metricsSnapshot: {},
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

vi.mock('@/types/scaling', () => ({
  DEFAULT_SCALING_CONFIG: {
    weights: { cpu: 0.3, gas: 0.3, txPool: 0.2, ai: 0.2 },
    thresholds: { idle: 30, normal: 70, high: 77 },
    cooldownMs: 300000,
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================================
// Tests
// ============================================================

describe('ScalingAgent', () => {
  let agent: ScalingAgent;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Restore default mock implementations (vi.clearAllMocks only clears call history)
    const metricsStore = await import('@/core/instance-metrics-store');
    (metricsStore.getRecentMetrics as ReturnType<typeof vi.fn>).mockResolvedValue([{
      instanceId: 'inst-1',
      timestamp: '2026-03-03T00:00:00.000Z',
      fields: { cpuUsage: 60, txPoolPending: 50, gasUsedRatio: 0.5 },
    }]);

    const k8s = await import('@/lib/k8s-scaler');
    (k8s.getCurrentVcpu as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (k8s.isAutoScalingEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (k8s.checkCooldown as ReturnType<typeof vi.fn>).mockResolvedValue({ inCooldown: false, remainingSeconds: 0 });

    const predictive = await import('@/lib/predictive-scaler');
    (predictive.predictScaling as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    agent = new ScalingAgent({ instanceId: 'inst-1', protocolId: 'opstack', intervalMs: 50 });
  });

  afterEach(() => {
    agent.stop();
    vi.useRealTimers();
  });

  it('should have domain = scaling', () => {
    expect(agent.domain).toBe('scaling');
  });

  it('should default interval to 30s', () => {
    const defaultAgent = new ScalingAgent({ instanceId: 'inst-2', protocolId: 'opstack' });
    expect(defaultAgent.getIntervalMs()).toBe(30_000);
  });

  it('should emit scaling-recommendation when target differs from current', async () => {
    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scaling-recommendation',
        instanceId: 'inst-1',
      })
    );
  });

  it('should include decision in event payload', async () => {
    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    const call = mockBusEmit.mock.calls[0][0];
    expect(call.payload.decision).toEqual(
      expect.objectContaining({ score: 55, targetVcpu: 2 })
    );
    expect(call.payload.currentVcpu).toBe(1);
  });

  it('should not emit when target equals current vCPU', async () => {
    const { getCurrentVcpu } = await import('@/lib/k8s-scaler');
    (getCurrentVcpu as ReturnType<typeof vi.fn>).mockResolvedValue(2); // matches target

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).not.toHaveBeenCalled();
  });

  it('should skip when no metrics available', async () => {
    const { getRecentMetrics } = await import('@/core/instance-metrics-store');
    (getRecentMetrics as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).not.toHaveBeenCalled();
  });

  it('should record experience when recommending scaling', async () => {
    const { recordExperience } = await import('@/lib/experience-store');

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(recordExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: 'inst-1',
        category: 'scaling-action',
        action: expect.stringContaining('recommend 1→2 vCPU'),
      })
    );
  });

  it('should handle predictive override', async () => {
    const { predictScaling } = await import('@/lib/predictive-scaler');
    const { getCurrentVcpu } = await import('@/lib/k8s-scaler');
    (getCurrentVcpu as ReturnType<typeof vi.fn>).mockResolvedValue(2); // matches target normally
    (predictScaling as ReturnType<typeof vi.fn>).mockResolvedValue({
      shouldScale: true,
      predictedTier: 'High',
      confidence: 0.85,
    });

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    // Should emit due to predictive override even though target == current
    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scaling-recommendation',
        payload: expect.objectContaining({ predictiveOverride: true }),
      })
    );
  });

  it('should survive predictive scaler failure', async () => {
    const { predictScaling } = await import('@/lib/predictive-scaler');
    (predictScaling as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('AI unavailable'));

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    // Should still emit based on scoring
    expect(mockBusEmit).toHaveBeenCalled();
    expect(agent.isRunning()).toBe(true);
  });
});
