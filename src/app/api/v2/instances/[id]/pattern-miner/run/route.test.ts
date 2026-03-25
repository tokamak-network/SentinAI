import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/core/instance-registry', () => ({
  getInstance: vi.fn(async () => ({ instanceId: 'inst-a' })),
}));

const { upsertPlaybook } = vi.hoisted(() => ({
  upsertPlaybook: vi.fn(async () => undefined),
}));

vi.mock('@/playbooks/learning/store', () => ({
  listOperationLedger: vi.fn(async () => ({
    records: [
      {
        operationId: 'op-1',
        instanceId: 'inst-a',
        timestamp: '2026-02-28T00:00:00.000Z',
        trigger: { anomalyType: 'z-score', metricName: 'txPoolPending', metricValue: 120, zScore: 3.2 },
        playbookId: null,
        action: 'restart-batcher',
        outcome: 'success',
        resolutionMs: 9000,
        verificationPassed: true,
      },
      {
        operationId: 'op-2',
        instanceId: 'inst-a',
        timestamp: '2026-02-28T00:01:00.000Z',
        trigger: { anomalyType: 'z-score', metricName: 'txPoolPending', metricValue: 121, zScore: 3.3 },
        playbookId: null,
        action: 'restart-batcher',
        outcome: 'success',
        resolutionMs: 9200,
        verificationPassed: true,
      },
      {
        operationId: 'op-3',
        instanceId: 'inst-a',
        timestamp: '2026-02-28T00:02:00.000Z',
        trigger: { anomalyType: 'z-score', metricName: 'txPoolPending', metricValue: 122, zScore: 3.4 },
        playbookId: null,
        action: 'restart-batcher',
        outcome: 'failure',
        resolutionMs: 12000,
        verificationPassed: false,
      },
    ],
    total: 3,
  })),
  listPlaybooks: vi.fn(async () => []),
  upsertPlaybook,
}));

import { POST } from './route';

describe('POST /api/v2/instances/[id]/pattern-miner/run', () => {
  it('mines patterns and upserts playbooks', async () => {
    const req = new NextRequest('http://localhost/api/v2/instances/inst-a/pattern-miner/run', {
      method: 'POST',
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'inst-a' }) });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.patterns).toBeGreaterThan(0);
    expect(upsertPlaybook).toHaveBeenCalled();
  });
});
