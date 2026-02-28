import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/core/instance-registry', () => ({
  getInstance: vi.fn(async () => ({ instanceId: 'inst-a' })),
}));

vi.mock('@/core/playbook-system/store', () => ({
  listOperationLedger: vi.fn(async () => ({
    total: 2,
    records: [
      {
        operationId: 'op-2',
        instanceId: 'inst-a',
        timestamp: '2026-02-28T00:02:00.000Z',
        trigger: { anomalyType: 'z-score', metricName: 'txPoolPending', metricValue: 122 },
        playbookId: 'pb-1',
        action: 'restart-batcher',
        outcome: 'success',
        resolutionMs: 9000,
        verificationPassed: true,
      },
    ],
  })),
}));

import { GET } from './route';

describe('GET /api/v2/instances/[id]/operation-ledger', () => {
  it('returns paginated operation ledger records', async () => {
    const req = new NextRequest('http://localhost/api/v2/instances/inst-a/operation-ledger?limit=1&offset=0');
    const res = await GET(req, { params: Promise.resolve({ id: 'inst-a' }) });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.instanceId).toBe('inst-a');
    expect(json.data.total).toBe(2);
    expect(json.data.records).toHaveLength(1);
  });
});
