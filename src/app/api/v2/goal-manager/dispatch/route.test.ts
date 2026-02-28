import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/v2/goal-manager/dispatch/route';

const hoisted = vi.hoisted(() => ({
  managerMock: {
    dispatchTopGoal: vi.fn(),
  },
}));

vi.mock('@/lib/goal-manager', () => ({
  dispatchTopGoal: hoisted.managerMock.dispatchTopGoal,
}));

describe('/api/v2/goal-manager/dispatch', () => {
  const originalApiKey = process.env.SENTINAI_API_KEY;
  const originalReadOnly = process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SENTINAI_API_KEY = 'test-admin-key';

    hoisted.managerMock.dispatchTopGoal.mockResolvedValue({
      enabled: true,
      dispatched: true,
      goalId: 'goal-1',
      planId: 'plan-1',
      status: 'completed',
      executionLogCount: 3,
    });
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.SENTINAI_API_KEY;
    } else {
      process.env.SENTINAI_API_KEY = originalApiKey;
    }

    if (originalReadOnly === undefined) {
      delete process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE;
    } else {
      process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE = originalReadOnly;
    }
  });

  it('rejects unauthorized requests', async () => {
    const request = new NextRequest('http://localhost/api/v2/goal-manager/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(hoisted.managerMock.dispatchTopGoal).not.toHaveBeenCalled();
  });

  it('dispatches when authorized', async () => {
    const request = new NextRequest('http://localhost/api/v2/goal-manager/dispatch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-admin-key',
      },
      body: JSON.stringify({
        dryRun: true,
        allowWrites: false,
        now: 123456,
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.version).toBe('v2');
    expect(body.data.dispatched).toBe(true);
    expect(hoisted.managerMock.dispatchTopGoal).toHaveBeenCalledWith({
      now: 123456,
      dryRun: true,
      allowWrites: false,
      initiatedBy: 'api',
    });
  });
});
