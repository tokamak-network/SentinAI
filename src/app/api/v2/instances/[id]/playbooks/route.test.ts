import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/core/instance-registry', () => ({
  getInstance: vi.fn(async () => ({ instanceId: 'inst-a' })),
}));

vi.mock('@/core/playbook-system/store', () => ({
  listPlaybooks: vi.fn(async () => [
    {
      playbookId: 'pb-1',
      instanceId: 'inst-a',
      triggerSignature: 'sig',
      action: 'restart-batcher',
      confidence: 0.8,
      reviewStatus: 'approved',
      generatedFrom: 'pattern',
      performance: {
        totalApplications: 5,
        successRate: 0.8,
        avgResolutionMs: 10000,
        lastApplied: '2026-02-28T00:00:00.000Z',
        lastOutcome: 'success',
      },
      evolution: {
        version: 1,
        changelog: [],
      },
    },
  ]),
}));

import { GET } from './route';

describe('GET /api/v2/instances/[id]/playbooks', () => {
  it('returns playbook list for instance', async () => {
    const req = new NextRequest('http://localhost/api/v2/instances/inst-a/playbooks');
    const res = await GET(req, { params: Promise.resolve({ id: 'inst-a' }) });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.instanceId).toBe('inst-a');
    expect(json.data.playbooks).toHaveLength(1);
  });
});
