import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/goal-manager/replay/route';

const hoisted = vi.hoisted(() => ({
  managerMock: {
    replayGoalManagerDlq: vi.fn(),
  },
}));

vi.mock('@/lib/goal-manager', () => ({
  replayGoalManagerDlq: hoisted.managerMock.replayGoalManagerDlq,
}));

describe('/api/goal-manager/replay', () => {
  const originalApiKey = process.env.SENTINAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SENTINAI_API_KEY = 'test-admin-key';
    hoisted.managerMock.replayGoalManagerDlq.mockResolvedValue({
      replayed: true,
      goalId: 'goal-1',
    });
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.SENTINAI_API_KEY;
    } else {
      process.env.SENTINAI_API_KEY = originalApiKey;
    }
  });

  it('should reject unauthorized replay requests', async () => {
    const request = new NextRequest('http://localhost/api/goal-manager/replay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goalId: 'goal-1' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toContain('Unauthorized');
  });

  it('should validate goalId', async () => {
    const request = new NextRequest('http://localhost/api/goal-manager/replay', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-admin-key',
      },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('should replay dlq goal when authorized', async () => {
    const request = new NextRequest('http://localhost/api/goal-manager/replay', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-admin-key',
      },
      body: JSON.stringify({ goalId: 'goal-1' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.replayed).toBe(true);
    expect(hoisted.managerMock.replayGoalManagerDlq).toHaveBeenCalledWith('goal-1');
  });
});
