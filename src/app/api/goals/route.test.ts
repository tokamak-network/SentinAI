import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/goals/route';

const hoisted = vi.hoisted(() => ({
  plannerMock: {
    buildGoalPlan: vi.fn(),
    executeGoalPlan: vi.fn(),
    getGoalPlanById: vi.fn(),
    getGoalPlanHistory: vi.fn(),
    saveGoalPlan: vi.fn(),
  },
}));

vi.mock('@/lib/goal-planner', () => ({
  buildGoalPlan: hoisted.plannerMock.buildGoalPlan,
  executeGoalPlan: hoisted.plannerMock.executeGoalPlan,
  getGoalPlanById: hoisted.plannerMock.getGoalPlanById,
  getGoalPlanHistory: hoisted.plannerMock.getGoalPlanHistory,
  saveGoalPlan: hoisted.plannerMock.saveGoalPlan,
}));

describe('/api/goals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE;

    hoisted.plannerMock.buildGoalPlan.mockReturnValue({
      planId: 'plan-1',
      goal: 'test',
      intent: 'custom',
      status: 'planned',
      dryRun: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      summary: 'plan',
      steps: [],
    });
    hoisted.plannerMock.saveGoalPlan.mockImplementation((plan: unknown) => plan);
    hoisted.plannerMock.executeGoalPlan.mockResolvedValue({
      plan: {
        planId: 'plan-1',
        goal: 'test',
        intent: 'custom',
        status: 'completed',
        dryRun: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        summary: 'done',
        steps: [],
      },
      executionLog: [],
    });
    hoisted.plannerMock.getGoalPlanHistory.mockReturnValue([]);
    hoisted.plannerMock.getGoalPlanById.mockReturnValue(null);
  });

  it('returns plan list on GET', async () => {
    const request = new NextRequest('http://localhost/api/goals?limit=5');
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.plans)).toBe(true);
  });

  it('validates required goal on POST', async () => {
    const request = new NextRequest('http://localhost/api/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('executes goal plan when autoExecute is true', async () => {
    const request = new NextRequest('http://localhost/api/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goal: 'stabilize',
        autoExecute: true,
        dryRun: true,
        allowWrites: false,
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(hoisted.plannerMock.executeGoalPlan).toHaveBeenCalled();
  });

  it('blocks write execution in read-only mode by policy', async () => {
    process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE = 'true';

    const request = new NextRequest('http://localhost/api/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goal: 'stabilize',
        autoExecute: true,
        dryRun: false,
        allowWrites: true,
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.reasonCode).toBe('read_only_write_blocked');
    expect(hoisted.plannerMock.executeGoalPlan).not.toHaveBeenCalled();
  });
});
