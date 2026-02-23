import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getStoreMock: vi.fn(),
  getLastCycleResultMock: vi.fn(),
  getSchedulerStatusMock: vi.fn(),
}));

vi.mock('@/lib/redis-store', () => ({
  getStore: hoisted.getStoreMock,
}));

vi.mock('@/lib/agent-loop', () => ({
  getLastCycleResult: hoisted.getLastCycleResultMock,
}));

vi.mock('@/lib/scheduler', () => ({
  getSchedulerStatus: hoisted.getSchedulerStatusMock,
}));

const { GET } = await import('@/app/api/health/route');

describe('/api/health', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-23T16:00:00.000Z'));
    vi.clearAllMocks();

    hoisted.getStoreMock.mockReturnValue({
      getAgentLoopHeartbeat: vi.fn().mockResolvedValue('2026-02-23T15:59:00.000Z'),
    });
    hoisted.getLastCycleResultMock.mockResolvedValue({
      timestamp: '2026-02-23T15:58:00.000Z',
      phase: 'complete',
    });
    hoisted.getSchedulerStatusMock.mockReturnValue({
      initialized: true,
      agentLoopEnabled: true,
      agentTaskRunning: false,
      snapshotTaskRunning: false,
      reportTaskRunning: false,
      scheduledScalingTaskRunning: false,
      watchdogEnabled: true,
      watchdogTaskRunning: false,
      watchdogRecoveryRunning: false,
      watchdogFailureStreak: 0,
      watchdogLastError: null,
      watchdogLastHealthyAt: '2026-02-23T15:59:00.000Z',
      watchdogLastAlertAt: null,
      watchdogLastRecoveryAt: null,
      watchdogLastRecoveryStatus: 'idle',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AGENT_HEARTBEAT_STALE_SECONDS;
  });

  it('returns heartbeat lag and non-stale state when heartbeat is fresh', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.agentLoop.heartbeatLagSec).toBe(60);
    expect(body.agentLoop.stale).toBe(false);
    expect(body.agentLoop.lastCycleAt).toBe('2026-02-23T15:58:00.000Z');
  });

  it('marks stale when heartbeat is missing while loop is enabled', async () => {
    hoisted.getStoreMock.mockReturnValue({
      getAgentLoopHeartbeat: vi.fn().mockResolvedValue(null),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.agentLoop.heartbeatLagSec).toBeNull();
    expect(body.agentLoop.stale).toBe(true);
  });

  it('returns degraded payload when health dependencies throw', async () => {
    hoisted.getStoreMock.mockImplementation(() => {
      throw new Error('store unavailable');
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.agentLoop.stale).toBe(true);
    expect(body.error).toContain('store unavailable');
  });
});
