import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/v2/goal-manager/tick/route';

const hoisted = vi.hoisted(() => ({
  managerMock: {
    tickGoalManager: vi.fn(),
  },
}));

vi.mock('@/lib/goal-manager', () => ({
  tickGoalManager: hoisted.managerMock.tickGoalManager,
}));

describe('/api/v2/goal-manager/tick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.managerMock.tickGoalManager.mockResolvedValue({
      enabled: true,
      generatedCount: 2,
      queuedCount: 1,
      suppressedCount: 1,
      queueDepth: 3,
      llmEnhanced: false,
    });
  });

  it('triggers tick and returns v2 payload envelope', async () => {
    const request = new NextRequest('http://localhost/api/v2/goal-manager/tick', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ now: 123456 }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.version).toBe('v2');
    expect(body.data.enabled).toBe(true);
    expect(hoisted.managerMock.tickGoalManager).toHaveBeenCalledWith(123456);
  });
});
