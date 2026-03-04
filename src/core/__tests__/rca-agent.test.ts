import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RCADomainAgent } from '@/core/agents/rca-agent';

// ============================================================
// Mocks
// ============================================================

vi.mock('@/lib/rca-engine', () => ({
  performRCA: vi.fn().mockResolvedValue({
    id: 'rca-1',
    rootCause: { component: { name: 'op-geth', status: 'degraded' }, description: 'op-geth memory pressure', confidence: 0.85 },
    causalChain: [],
    affectedComponents: [{ name: 'op-geth', status: 'degraded' }],
    timeline: [],
    remediation: { actions: [{ type: 'restart', target: 'op-geth', description: 'Increase memory allocation' }] },
  }),
  addRCAHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/experience-store', () => ({
  recordExperience: vi.fn().mockResolvedValue({
    id: 'exp-1', instanceId: 'inst-1', protocolId: 'opstack',
    timestamp: '2026-03-03T00:00:00.000Z', category: 'rca-diagnosis',
    trigger: { type: 'anomaly', metric: 'gasUsedRatio', value: 3.5 },
    action: 'RCA', outcome: 'success', resolutionMs: 100, metricsSnapshot: {},
  }),
}));

const mockBusEmit = vi.fn();
const mockBusOn = vi.fn();
const mockBusOff = vi.fn();
vi.mock('@/core/agent-event-bus', () => ({
  getAgentEventBus: () => ({
    emit: mockBusEmit,
    on: mockBusOn,
    off: mockBusOff,
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

describe('RCADomainAgent', () => {
  let agent: RCADomainAgent;

  beforeEach(async () => {
    vi.clearAllMocks();

    const rcaMod = await import('@/lib/rca-engine');
    (rcaMod.performRCA as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'rca-1',
      rootCause: { component: { name: 'op-geth', status: 'degraded' }, description: 'op-geth memory pressure', confidence: 0.85 },
      causalChain: [],
      affectedComponents: [{ name: 'op-geth', status: 'degraded' }],
      timeline: [],
      remediation: { actions: [{ type: 'restart', target: 'op-geth', description: 'Increase memory allocation' }] },
    });

    agent = new RCADomainAgent({ instanceId: 'inst-1', protocolId: 'opstack' });
  });

  afterEach(() => {
    agent.stop();
  });

  it('should have domain = rca', () => {
    expect(agent.domain).toBe('rca');
  });

  it('should subscribe to anomaly-detected on start', () => {
    agent.start();
    expect(mockBusOn).toHaveBeenCalledWith('anomaly-detected', expect.any(Function));
    expect(agent.isRunning()).toBe(true);
  });

  it('should unsubscribe on stop', () => {
    agent.start();
    agent.stop();
    expect(mockBusOff).toHaveBeenCalledWith('anomaly-detected', expect.any(Function));
    expect(agent.isRunning()).toBe(false);
  });

  it('should be idempotent on start', () => {
    agent.start();
    agent.start(); // should warn, not double-subscribe
    expect(mockBusOn).toHaveBeenCalledTimes(1);
  });

  it('should run RCA when anomaly event is received', async () => {
    agent.start();

    // Get the registered handler and call it
    const handler = mockBusOn.mock.calls[0][1];
    handler({
      type: 'anomaly-detected',
      instanceId: 'inst-1',
      payload: {
        detection: {
          hasAnomaly: true,
          anomalies: [{ fieldName: 'gasUsedRatio', displayName: 'Gas Used Ratio', method: 'z-score', currentValue: 0.95, zScore: 3.5, severity: 'high', message: 'anomaly' }],
        },
      },
      timestamp: '2026-03-03T00:00:00.000Z',
      correlationId: 'corr-123',
    });
    // Flush microtasks from fire-and-forget handler
    await new Promise(resolve => setTimeout(resolve, 0));

    const { performRCA, addRCAHistory } = await import('@/lib/rca-engine');
    expect(performRCA).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ metric: 'gasUsedRatio' })]),
      expect.any(Object),
      expect.any(Array),
    );
    expect(addRCAHistory).toHaveBeenCalledWith(
      expect.objectContaining({ rootCause: expect.objectContaining({ description: 'op-geth memory pressure' }) }),
      'auto'
    );
  });

  it('should emit rca-result event', async () => {
    agent.start();

    const handler = mockBusOn.mock.calls[0][1];
    handler({
      type: 'anomaly-detected',
      instanceId: 'inst-1',
      payload: {
        detection: {
          hasAnomaly: true,
          anomalies: [{ fieldName: 'cpuUsage', displayName: 'CPU Usage', method: 'z-score', currentValue: 95, zScore: 4.0, severity: 'high', message: 'anomaly' }],
        },
      },
      timestamp: '2026-03-03T00:00:00.000Z',
      correlationId: 'corr-456',
    });
    // Flush microtasks from fire-and-forget handler
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'rca-result',
        correlationId: 'corr-456',
        payload: expect.objectContaining({
          rcaResult: expect.objectContaining({ rootCause: expect.objectContaining({ description: 'op-geth memory pressure' }) }),
        }),
      })
    );
  });

  it('should ignore events from other instances', async () => {
    agent.start();

    const handler = mockBusOn.mock.calls[0][1];
    await handler({
      type: 'anomaly-detected',
      instanceId: 'other-instance',
      payload: { detection: { hasAnomaly: true, anomalies: [{ fieldName: 'cpuUsage', displayName: 'CPU', method: 'z-score', currentValue: 95, zScore: 5.0, severity: 'high', message: 'anomaly' }] } },
      timestamp: '2026-03-03T00:00:00.000Z',
      correlationId: 'corr-789',
    });

    const { performRCA } = await import('@/lib/rca-engine');
    expect(performRCA).not.toHaveBeenCalled();
  });

  it('should ignore events without anomalies', async () => {
    agent.start();

    const handler = mockBusOn.mock.calls[0][1];
    await handler({
      type: 'anomaly-detected',
      instanceId: 'inst-1',
      payload: { detection: { hasAnomaly: false, anomalies: [] } },
      timestamp: '2026-03-03T00:00:00.000Z',
      correlationId: 'corr-000',
    });

    const { performRCA } = await import('@/lib/rca-engine');
    expect(performRCA).not.toHaveBeenCalled();
  });

  it('should survive RCA engine failure', async () => {
    const rcaMod = await import('@/lib/rca-engine');
    (rcaMod.performRCA as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('AI unavailable'));

    agent.start();

    const handler = mockBusOn.mock.calls[0][1];
    await handler({
      type: 'anomaly-detected',
      instanceId: 'inst-1',
      payload: {
        detection: { hasAnomaly: true, anomalies: [{ fieldName: 'cpuUsage', displayName: 'CPU', method: 'z-score', currentValue: 90, zScore: 3.0, severity: 'medium', message: 'anomaly' }] },
      },
      timestamp: '2026-03-03T00:00:00.000Z',
      correlationId: 'corr-err',
    });

    expect(agent.isRunning()).toBe(true);
    // Should record failure experience
    const { recordExperience } = await import('@/lib/experience-store');
    expect(recordExperience).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' })
    );
  });

  it('should track diagnosis count', async () => {
    agent.start();
    expect(agent.getDiagnosisCount()).toBe(0);

    const handler = mockBusOn.mock.calls[0][1];
    handler({
      type: 'anomaly-detected',
      instanceId: 'inst-1',
      payload: {
        detection: { hasAnomaly: true, anomalies: [{ fieldName: 'cpuUsage', displayName: 'CPU', method: 'z-score', currentValue: 90, zScore: 3.0, severity: 'medium', message: 'anomaly' }] },
      },
      timestamp: '2026-03-03T00:00:00.000Z',
      correlationId: 'corr-cnt',
    });
    // Flush microtasks from fire-and-forget handler
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(agent.getDiagnosisCount()).toBe(1);
  });
});
