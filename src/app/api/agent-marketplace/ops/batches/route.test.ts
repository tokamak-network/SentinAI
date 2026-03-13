import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getBatchHistoryMock: vi.fn(),
}));

vi.mock('@/lib/agent-marketplace/batch-history-store', () => ({
  getAgentMarketplaceBatchHistory: hoisted.getBatchHistoryMock,
}));

const { GET } = await import('@/app/api/agent-marketplace/ops/batches/route');

describe('/api/agent-marketplace/ops/batches', () => {
  it('returns newest-first batch history with default limit', async () => {
    hoisted.getBatchHistoryMock.mockResolvedValue([
      {
        status: 'success',
        publishedAt: '2026-03-12T04:00:00.000Z',
        window: {
          fromIso: '2026-03-11T00:00:00.000Z',
          toIso: '2026-03-12T00:00:00.000Z',
        },
        batchHash: 'QmBatchCid2',
        txHash: '0xtxbatch',
        merkleRoot: '0x' + 'c'.repeat(64),
        error: null,
      },
      {
        status: 'failed',
        publishedAt: '2026-03-11T04:00:00.000Z',
        window: {
          fromIso: '2026-03-10T00:00:00.000Z',
          toIso: '2026-03-11T00:00:00.000Z',
        },
        batchHash: null,
        txHash: null,
        merkleRoot: '0x' + 'd'.repeat(64),
        error: 'submit failed',
      },
    ]);

    const response = await GET(new Request('http://localhost/api/agent-marketplace/ops/batches'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.limit).toBe(10);
    expect(body.items[0].publishedAt).toBe('2026-03-12T04:00:00.000Z');
  });

  it('applies a bounded limit query parameter', async () => {
    hoisted.getBatchHistoryMock.mockResolvedValue([
      {
        status: 'success',
        publishedAt: '2026-03-12T04:00:00.000Z',
        window: {
          fromIso: '2026-03-11T00:00:00.000Z',
          toIso: '2026-03-12T00:00:00.000Z',
        },
        batchHash: 'QmBatchCid2',
        txHash: '0xtxbatch',
        merkleRoot: '0x' + 'c'.repeat(64),
        error: null,
      },
      {
        status: 'failed',
        publishedAt: '2026-03-11T04:00:00.000Z',
        window: {
          fromIso: '2026-03-10T00:00:00.000Z',
          toIso: '2026-03-11T00:00:00.000Z',
        },
        batchHash: null,
        txHash: null,
        merkleRoot: '0x' + 'd'.repeat(64),
        error: 'submit failed',
      },
    ]);

    const response = await GET(new Request('http://localhost/api/agent-marketplace/ops/batches?limit=1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.limit).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].publishedAt).toBe('2026-03-12T04:00:00.000Z');
  });
});
