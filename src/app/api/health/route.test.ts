import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getLastCycleMock: vi.fn(),
  getSchedulerStatusMock: vi.fn(),
  // Default return value needed for rca-engine.ts module-level DEPENDENCY_GRAPH initialization
  getChainPluginMock: vi.fn().mockReturnValue({
    chainType: 'thanos',
    displayName: 'Thanos L2 Rollup',
    chainMode: 'legacy',
    capabilities: {},
    dependencyGraph: {},
  }),
}));

vi.mock('@/lib/cycle-store', () => ({
  getLastCycle: hoisted.getLastCycleMock,
}));

vi.mock('@/lib/scheduler', () => ({
  getSchedulerStatus: hoisted.getSchedulerStatusMock,
}));

vi.mock('@/chains', () => ({
  getChainPlugin: hoisted.getChainPluginMock,
}));

const { GET } = await import('@/app/api/health/route');

describe('/api/health', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-23T16:00:00.000Z'));
    vi.clearAllMocks();

    hoisted.getLastCycleMock.mockResolvedValue({
      timestamp: '2026-02-23T15:58:00.000Z',
      phase: 'complete',
    });
    hoisted.getChainPluginMock.mockReturnValue({
      chainType: 'zkl2-generic',
      displayName: 'ZK L2 Generic',
      chainMode: 'generic',
      capabilities: {
        proofMonitoring: true,
        settlementMonitoring: true,
        eoaBalanceMonitoring: true,
      },
      dependencyGraph: {},
    });

    hoisted.getSchedulerStatusMock.mockReturnValue({
      initialized: true,
      agentLoopEnabled: true,
      agentV2Enabled: true,
      agentTaskRunning: false,
      snapshotTaskRunning: false,
      reportTaskRunning: false,
      scheduledScalingTaskRunning: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AGENT_HEARTBEAT_STALE_SECONDS;
  });

  it('returns ok status with chain and agentLoop info when healthy', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.chain.type).toBe('zkl2-generic');
    expect(body.chain.capabilities.proofMonitoring).toBe(true);
    expect(body.agentLoop.lastCycleAt).toBe('2026-02-23T15:58:00.000Z');
    expect(body.agentLoop.lastCyclePhase).toBe('complete');
    expect(body.agentLoop.enabled).toBe(true);
    expect(body.agentLoop.schedulerInitialized).toBe(true);
  });

  it('returns ok with null lastCycleAt when no cycle has run', async () => {
    hoisted.getLastCycleMock.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.agentLoop.lastCycleAt).toBeNull();
    expect(body.agentLoop.lastCyclePhase).toBeNull();
  });

  it('returns degraded status when dependencies throw', async () => {
    hoisted.getLastCycleMock.mockRejectedValue(new Error('store unavailable'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.chain.type).toBe('zkl2-generic');
    expect(body.agentLoop.stale).toBe(true);
    expect(body.error).toContain('store unavailable');
  });

  it('returns strict capability snapshot for zkstack chain', async () => {
    hoisted.getChainPluginMock.mockReturnValue({
      chainType: 'zkstack',
      displayName: 'ZK Stack L2 (legacy-era)',
      chainMode: 'legacy-era',
      capabilities: {
        proofMonitoring: false,
        settlementMonitoring: true,
        eoaBalanceMonitoring: true,
      },
      dependencyGraph: {},
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.chain.type).toBe('zkstack');
    expect(body.chain.mode).toBe('legacy-era');
    expect(body.chain.capabilities).toEqual({
      proofMonitoring: false,
      settlementMonitoring: true,
      eoaBalanceMonitoring: true,
    });
  });

  it('omits chain snapshot when chain plugin cannot be resolved', async () => {
    hoisted.getChainPluginMock.mockImplementation(() => {
      throw new Error('chain unavailable');
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.chain).toBeUndefined();
  });
});
