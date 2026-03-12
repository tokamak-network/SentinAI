import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/agent-fleet/route';

const hoisted = vi.hoisted(() => ({
  getStatusesMock: vi.fn(),
  getCycleHistoryMock: vi.fn(),
  getExperienceStatsMock: vi.fn(),
}));

vi.mock('@/core/agent-orchestrator', () => ({
  getAgentOrchestrator: () => ({
    getStatuses: hoisted.getStatusesMock,
  }),
}));

vi.mock('@/lib/cycle-store', () => ({
  getCycleHistory: hoisted.getCycleHistoryMock,
}));

vi.mock('@/lib/experience-store', () => ({
  getExperienceStats: hoisted.getExperienceStatsMock,
}));

describe('/api/agent-fleet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const now = Date.now();
    const t0 = new Date(now - 10_000).toISOString();
    const t1 = new Date(now - 8_000).toISOString();
    const t2 = new Date(now - 7_000).toISOString();
    const t3 = new Date(now - 5_000).toISOString();

    hoisted.getStatusesMock.mockReturnValue([
      { role: 'collector', instanceId: 'inst-a', running: true, lastActivityAt: t2 },
      { role: 'detector', instanceId: 'inst-a', running: true, lastActivityAt: t3 },
    ]);
    hoisted.getCycleHistoryMock.mockResolvedValue([
      {
        timestamp: t3,
        phase: 'complete',
        phaseTrace: [
          { phase: 'observe', startedAt: t0, endedAt: t1, ok: true },
          { phase: 'detect', startedAt: t1, endedAt: t2, ok: true },
        ],
      },
    ]);
    hoisted.getExperienceStatsMock.mockResolvedValue({
      totalOperations: 100,
      successRate: 1.0,
      avgResolutionMs: 5000,
      operatingDays: 10,
      topCategories: [{ category: 'observe', count: 40 }],
    });
  });

  it('returns aggregated fleet snapshot', async () => {
    const response = await GET(new Request('http://localhost/api/agent-fleet?limit=120'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary.totalAgents).toBe(2);
    expect(body.summary.instanceCount).toBe(1);
    expect(body.kpi.successRate).toBe(100);
    expect(body.agents).toHaveLength(2);
    expect(body.agentV2).toBe(true);
    expect(typeof body.updatedAt).toBe('string');
    expect(hoisted.getCycleHistoryMock).toHaveBeenCalledWith(120);
  });

  it('returns 500 when cycle history fails', async () => {
    hoisted.getCycleHistoryMock.mockRejectedValueOnce(new Error('history unavailable'));

    const response = await GET(new Request('http://localhost/api/agent-fleet'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain('history unavailable');
  });
});
