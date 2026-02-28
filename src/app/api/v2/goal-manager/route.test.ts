import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/v2/goal-manager/route';

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

describe('/api/v2/goal-manager', () => {
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
        {
          goalId: 'goal-2',
          candidateId: 'candidate-2',
          enqueuedAt: '2026-02-22T12:01:00.000Z',
          attempts: 1,
          status: 'failed',
          goal: 'sample-2',
          intent: 'stabilize',
          source: 'anomaly',
          risk: 'high',
          confidence: 0.8,
          signature: 'sig-2',
          score: { impact: 20, urgency: 15, confidence: 16, policyFit: 10, total: 61 },
        },
      ],
      dlq: [
        {
          id: 'dlq-1',
          goalId: 'goal-dlq',
          movedAt: '2026-02-22T12:02:00.000Z',
          reason: 'max_retries_exceeded',
          attempts: 2,
          queueItem: {
            goalId: 'goal-dlq',
            candidateId: 'candidate-dlq',
            enqueuedAt: '2026-02-22T11:58:00.000Z',
            attempts: 2,
            status: 'dlq',
            goal: 'dlq sample',
            intent: 'investigate',
            source: 'anomaly',
            risk: 'high',
            confidence: 0.7,
            signature: 'sig-dlq',
            score: { impact: 15, urgency: 10, confidence: 14, policyFit: 10, total: 49 },
          },
        },
      ],
      candidates: [{ id: 'candidate-x' }],
      suppression: [
        {
          id: 'sup-1',
          timestamp: '2026-02-22T12:02:00.000Z',
          candidateId: 'candidate-z',
          signature: 'sig-z',
          source: 'metrics',
          risk: 'low',
          reasonCode: 'duplicate_goal',
        },
      ],
      lastTickSuppressedCount: 1,
    });
  });

  it('returns v2-wrapped goal-manager state', async () => {
    const request = new NextRequest('http://localhost/api/v2/goal-manager?limit=10');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.version).toBe('v2');
    expect(body.data.config.enabled).toBe(true);
    expect(body.data.queueDepth).toBe(1);
    expect(body.data.summary.queueTotal).toBe(2);
    expect(body.data.summary.dlqTotal).toBe(1);
    expect(body.data.summary.candidateTotal).toBe(1);
    expect(body.data.summary.suppressionTotal).toBe(1);
    expect(body.data.summary.statusCounts.queued).toBe(1);
    expect(body.data.summary.statusCounts.failed).toBe(1);
    expect(body.data.summary.suppressionReasonCounts.duplicate_goal).toBe(1);
    expect(hoisted.managerMock.listGoalManagerState).toHaveBeenCalledWith(10);
  });
});
