import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/goal-manager/route';

const hoisted = vi.hoisted(() => ({
  managerMock: {
    getGoalManagerConfig: vi.fn(),
    listGoalManagerState: vi.fn(),
  },
}));

vi.mock('@/lib/goal-manager', () => ({
  getGoalManagerConfig: hoisted.managerMock.getGoalManagerConfig,
  listGoalManagerState: hoisted.managerMock.listGoalManagerState,
}));

describe('/api/goal-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hoisted.managerMock.getGoalManagerConfig.mockReturnValue({
      enabled: true,
      dispatchEnabled: false,
      llmEnhancerEnabled: false,
      dispatchDryRun: true,
      dispatchAllowWrites: false,
    });
    hoisted.managerMock.listGoalManagerState.mockResolvedValue({
      activeGoalId: null,
      queue: [
        {
          goalId: 'goal-1',
          candidateId: 'candidate-1',
          enqueuedAt: '2026-02-22T12:00:00.000Z',
          attempts: 0,
          status: 'queued',
          goal: 'sample',
          intent: 'investigate',
          source: 'metrics',
          risk: 'low',
          confidence: 0.6,
          signature: 'sig-1',
          score: { impact: 10, urgency: 8, confidence: 12, policyFit: 10, total: 40 },
        },
      ],
      dlq: [],
      candidates: [],
      suppression: [],
    });
  });

  it('should return goal-manager status snapshot', async () => {
    const request = new NextRequest('http://localhost/api/goal-manager?limit=10');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.config.enabled).toBe(true);
    expect(body.queueDepth).toBe(1);
    expect(Array.isArray(body.queue)).toBe(true);
    expect(Array.isArray(body.dlq)).toBe(true);
    expect(hoisted.managerMock.listGoalManagerState).toHaveBeenCalledWith(10);
  });
});
