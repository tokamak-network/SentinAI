import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/v2/goal-manager/replay/route';

const hoisted = vi.hoisted(() => ({
  managerMock: {
    replayGoalManagerDlq: vi.fn(),
  },
}));

vi.mock('@/lib/goal-manager', () => ({
  replayGoalManagerDlq: hoisted.managerMock.replayGoalManagerDlq,
}));

describe('/api/v2/goal-manager/replay', () => {
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

  it('rejects unauthorized replay requests', async () => {
    const request = new NextRequest('http://localhost/api/v2/goal-manager/replay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goalId: 'goal-1' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('replays dlq goal when authorized', async () => {
    const request = new NextRequest('http://localhost/api/v2/goal-manager/replay', {
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
    expect(body.meta.version).toBe('v2');
    expect(body.data.replayed).toBe(true);
    expect(hoisted.managerMock.replayGoalManagerDlq).toHaveBeenCalledWith('goal-1');
  });
});
