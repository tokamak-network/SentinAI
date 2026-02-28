import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/core/instance-registry', () => ({
  getInstance: vi.fn(async () => ({ instanceId: 'inst-a' })),
}));

const { getPlaybook, upsertPlaybook } = vi.hoisted(() => ({
  getPlaybook: vi.fn(async () => ({
    playbookId: 'pb-1',
    instanceId: 'inst-a',
    triggerSignature: 'sig',
    action: 'restart-batcher',
    confidence: 0.95,
    reviewStatus: 'pending',
    generatedFrom: 'pattern',
    performance: {
      totalApplications: 10,
      successRate: 0.9,
      avgResolutionMs: 10000,
      lastApplied: '2026-02-28T00:00:00.000Z',
      lastOutcome: 'success',
    },
    evolution: {
      version: 1,
      changelog: [],
    },
  })),
  upsertPlaybook: vi.fn(async () => undefined),
}));

vi.mock('@/core/playbook-system/store', () => ({
  getPlaybook,
  upsertPlaybook,
}));

import { GET as GET_HISTORY } from './history/route';
import { POST as POST_APPROVE } from './approve/route';
import { POST as POST_PROMOTE } from './promote/route';
import { POST as POST_SUSPEND } from './suspend/route';

describe('playbook lifecycle routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns playbook history', async () => {
    const req = new NextRequest('http://localhost/api/v2/instances/inst-a/playbooks/pb-1/history');
    const res = await GET_HISTORY(req, {
      params: Promise.resolve({ id: 'inst-a', playbookId: 'pb-1' }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.playbookId).toBe('pb-1');
    expect(json.data.timeline).toBeDefined();
  });

  it('approves playbook', async () => {
    const req = new NextRequest('http://localhost/api/v2/instances/inst-a/playbooks/pb-1/approve', {
      method: 'POST',
    });

    const res = await POST_APPROVE(req, {
      params: Promise.resolve({ id: 'inst-a', playbookId: 'pb-1' }),
    });

    expect(res.status).toBe(200);
    expect(upsertPlaybook).toHaveBeenCalled();
  });

  it('promotes playbook when confidence >= 0.9', async () => {
    const req = new NextRequest('http://localhost/api/v2/instances/inst-a/playbooks/pb-1/promote', {
      method: 'POST',
    });

    const res = await POST_PROMOTE(req, {
      params: Promise.resolve({ id: 'inst-a', playbookId: 'pb-1' }),
    });

    expect(res.status).toBe(200);
    expect(upsertPlaybook).toHaveBeenCalled();
  });

  it('suspends playbook', async () => {
    const req = new NextRequest('http://localhost/api/v2/instances/inst-a/playbooks/pb-1/suspend', {
      method: 'POST',
    });

    const res = await POST_SUSPEND(req, {
      params: Promise.resolve({ id: 'inst-a', playbookId: 'pb-1' }),
    });

    expect(res.status).toBe(200);
    expect(upsertPlaybook).toHaveBeenCalled();
  });
});
