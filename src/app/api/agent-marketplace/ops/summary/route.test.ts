import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  buildSummaryMock: vi.fn(),
}));

vi.mock('@/lib/agent-marketplace/ops-summary', () => ({
  buildAgentMarketplaceOpsSummary: hoisted.buildSummaryMock,
}));

const { GET } = await import('@/app/api/agent-marketplace/ops/summary/route');

describe('/api/agent-marketplace/ops/summary', () => {
  it('returns the composed ops summary payload', async () => {
    hoisted.buildSummaryMock.mockResolvedValue({
      enabled: true,
      window: {
        fromIso: '2026-03-11T00:00:00.000Z',
        toIso: '2026-03-12T00:00:00.000Z',
      },
      requestTotals: {
        total: 4,
        verified: 2,
        rejected: 1,
        rateLimited: 1,
      },
      distinctBuyerCount: 3,
      services: [],
      topBuyers: [],
      recentRequests: [],
      slaAgents: [],
      lastBatch: {
        status: 'never',
        publishedAt: null,
        batchHash: null,
        txHash: null,
        error: null,
      },
    });

    const response = await GET(new Request('http://localhost/api/agent-marketplace/ops/summary'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.requestTotals.total).toBe(4);
    expect(body.lastBatch.status).toBe('never');
    expect(hoisted.buildSummaryMock).toHaveBeenCalledTimes(1);
  });
});
