import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReliabilityAgent } from '@/core/agents/reliability-agent';

// ============================================================
// Mocks
// ============================================================

vi.mock('@/lib/l1-rpc-failover', () => ({
  getActiveL1RpcUrl: vi.fn().mockReturnValue('https://eth.example.com'),
  healthCheckEndpoint: vi.fn().mockResolvedValue(true),
  checkProxydBackends: vi.fn().mockResolvedValue(null),
  hasHealthyBackup: vi.fn().mockResolvedValue(true),
  getL1FailoverState: vi.fn().mockReturnValue({
    activeUrl: 'https://eth.example.com',
    activeIndex: 0,
    endpoints: [{ url: 'https://eth.example.com', healthy: true, lastSuccess: null, lastFailure: null, consecutiveFailures: 0 }],
    lastFailoverTime: null,
    events: [],
    proxydHealth: [],
    backendReplacements: [],
    spareUrls: [],
  }),
}));

vi.mock('@/lib/experience-store', () => ({
  recordExperience: vi.fn().mockResolvedValue({
    id: 'exp-1', instanceId: 'inst-1', protocolId: 'opstack',
    timestamp: '2026-03-03T00:00:00.000Z', category: 'reliability-failover',
    trigger: { type: 'l1-rpc-unhealthy', metric: 'l1_health', value: 1 },
    action: 'reliability issue', outcome: 'success', resolutionMs: 10, metricsSnapshot: {},
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

describe('ReliabilityAgent', () => {
  let agent: ReliabilityAgent;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    const failover = await import('@/lib/l1-rpc-failover');
    (failover.getActiveL1RpcUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://eth.example.com');
    (failover.healthCheckEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (failover.checkProxydBackends as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (failover.getL1FailoverState as ReturnType<typeof vi.fn>).mockReturnValue({
      activeUrl: 'https://eth.example.com',
      activeIndex: 0,
      endpoints: [{ url: 'https://eth.example.com', healthy: true, lastSuccess: null, lastFailure: null, consecutiveFailures: 0 }],
      lastFailoverTime: null, events: [], proxydHealth: [], backendReplacements: [], spareUrls: [],
    });
    (failover.hasHealthyBackup as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    agent = new ReliabilityAgent({ instanceId: 'inst-1', protocolId: 'opstack', intervalMs: 50 });
  });

  afterEach(() => {
    agent.stop();
    vi.useRealTimers();
  });

  it('should have domain = reliability', () => {
    expect(agent.domain).toBe('reliability');
  });

  it('should default interval to 30s', () => {
    const defaultAgent = new ReliabilityAgent({ instanceId: 'inst-2', protocolId: 'opstack' });
    expect(defaultAgent.getIntervalMs()).toBe(30_000);
  });

  it('should not emit when L1 RPC is healthy', async () => {
    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).not.toHaveBeenCalled();
  });

  it('should not emit on a single L1 health check failure (transient)', async () => {
    const failover = await import('@/lib/l1-rpc-failover');
    (failover.healthCheckEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).not.toHaveBeenCalled();
  });

  it('should emit reliability-issue after consecutive L1 health check failures', async () => {
    const failover = await import('@/lib/l1-rpc-failover');
    (failover.healthCheckEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    agent.start();
    // First tick — below threshold, no emit
    await vi.advanceTimersByTimeAsync(55);
    expect(mockBusEmit).not.toHaveBeenCalled();

    // Second tick — reaches threshold, should emit
    await vi.advanceTimersByTimeAsync(50);
    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reliability-issue',
        payload: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({ type: 'l1-rpc-unhealthy' }),
          ]),
        }),
      })
    );
  });

  it('should reset failure counter when health check recovers', async () => {
    const failover = await import('@/lib/l1-rpc-failover');
    (failover.healthCheckEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    agent.start();
    // First tick — failure #1
    await vi.advanceTimersByTimeAsync(55);
    expect(mockBusEmit).not.toHaveBeenCalled();

    // Recovery — health check succeeds, resets counter
    (failover.healthCheckEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(mockBusEmit).not.toHaveBeenCalled();

    // Fail again — should need 2 consecutive failures from scratch
    (failover.healthCheckEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(mockBusEmit).not.toHaveBeenCalled();
  });

  it('should detect consecutive failures from failover state when health check also fails', async () => {
    const failover = await import('@/lib/l1-rpc-failover');
    // Health check must also fail, otherwise check #3 is skipped
    (failover.healthCheckEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (failover.getL1FailoverState as ReturnType<typeof vi.fn>).mockReturnValue({
      activeUrl: 'https://eth.example.com',
      activeIndex: 0,
      endpoints: [{ url: 'https://eth.example.com', healthy: false, lastSuccess: null, lastFailure: null, consecutiveFailures: 5 }],
      lastFailoverTime: null, events: [], proxydHealth: [], backendReplacements: [], spareUrls: [],
    });

    agent.start();
    // First tick — health check fails but below threshold (1/2), however consecutiveFailures check triggers
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reliability-issue',
        payload: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({ type: 'l1-consecutive-failures' }),
          ]),
        }),
      })
    );
  });

  it('should skip failover state check when direct health check passes (stale counter)', async () => {
    const failover = await import('@/lib/l1-rpc-failover');
    // Direct health check passes
    (failover.healthCheckEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    // But failover state has stale consecutiveFailures
    (failover.getL1FailoverState as ReturnType<typeof vi.fn>).mockReturnValue({
      activeUrl: 'https://eth.example.com',
      activeIndex: 0,
      endpoints: [{ url: 'https://eth.example.com', healthy: false, lastSuccess: null, lastFailure: null, consecutiveFailures: 10 }],
      lastFailoverTime: null, events: [], proxydHealth: [], backendReplacements: [], spareUrls: [],
    });

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    // Should NOT emit — health check passed, stale counter should be ignored
    expect(mockBusEmit).not.toHaveBeenCalled();
  });

  it('should suppress failover event when no healthy backup is available', async () => {
    const failover = await import('@/lib/l1-rpc-failover');
    (failover.healthCheckEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (failover.hasHealthyBackup as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    agent.start();
    // 2 consecutive failures to reach threshold
    await vi.advanceTimersByTimeAsync(55);
    await vi.advanceTimersByTimeAsync(50);

    // Should NOT emit — no backup available
    expect(mockBusEmit).not.toHaveBeenCalled();
  });

  it('should emit failover event when healthy backup is available', async () => {
    const failover = await import('@/lib/l1-rpc-failover');
    (failover.healthCheckEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (failover.hasHealthyBackup as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    agent.start();
    // 2 consecutive failures to reach threshold
    await vi.advanceTimersByTimeAsync(55);
    await vi.advanceTimersByTimeAsync(50);

    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reliability-issue',
        payload: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({ type: 'l1-rpc-unhealthy' }),
          ]),
        }),
      })
    );
  });

  it('should detect proxyd backend replacement', async () => {
    const failover = await import('@/lib/l1-rpc-failover');
    (failover.checkProxydBackends as ReturnType<typeof vi.fn>).mockResolvedValue({
      backendName: 'main-0',
      reason: 'rate-limited',
    });

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reliability-issue',
        payload: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({ type: 'proxyd-backend-replaced' }),
          ]),
        }),
      })
    );
  });

  it('should survive L1 check failures gracefully', async () => {
    const failover = await import('@/lib/l1-rpc-failover');
    (failover.getActiveL1RpcUrl as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('No L1 RPC');
    });

    agent.start();
    await vi.advanceTimersByTimeAsync(55);

    expect(agent.isRunning()).toBe(true);
  });

  it('should record experience when issues detected', async () => {
    const failover = await import('@/lib/l1-rpc-failover');
    (failover.healthCheckEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const { recordExperience } = await import('@/lib/experience-store');

    agent.start();
    // Need 2 consecutive failures to trigger
    await vi.advanceTimersByTimeAsync(55);
    await vi.advanceTimersByTimeAsync(50);

    expect(recordExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'reliability-failover',
        trigger: expect.objectContaining({ type: 'l1-rpc-unhealthy' }),
      })
    );
  });
});
