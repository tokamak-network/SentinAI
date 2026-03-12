import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  createDisputeMock: vi.fn(),
  listDisputesMock: vi.fn(),
}));

vi.mock('@/lib/agent-marketplace/dispute-store', () => ({
  createAgentMarketplaceDispute: hoisted.createDisputeMock,
  listAgentMarketplaceDisputes: hoisted.listDisputesMock,
}));

const disputesRoute = await import('@/app/api/agent-marketplace/ops/disputes/route');

describe('/api/agent-marketplace/ops/disputes', () => {
  it('lists disputes', async () => {
    hoisted.listDisputesMock.mockResolvedValue([
      {
        id: 'disp_1',
        agentId: '0x00000000000000000000000000000000000000a1',
        batchHash: 'QmBatchCid',
        merkleRoot: '0x' + 'a'.repeat(64),
        requestedScore: 82,
        expectedScore: 91,
        reason: 'score mismatch',
        status: 'open',
        createdAt: '2026-03-12T00:00:00.000Z',
        updatedAt: '2026-03-12T00:00:00.000Z',
      },
    ]);

    const response = await disputesRoute.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.disputes).toHaveLength(1);
    expect(body.disputes[0].status).toBe('open');
  });

  it('creates a dispute', async () => {
    hoisted.createDisputeMock.mockResolvedValue({
      id: 'disp_1',
      agentId: '0x00000000000000000000000000000000000000a1',
      batchHash: 'QmBatchCid',
      merkleRoot: '0x' + 'a'.repeat(64),
      requestedScore: 82,
      expectedScore: 91,
      reason: 'score mismatch',
      status: 'open',
      createdAt: '2026-03-12T00:00:00.000Z',
      updatedAt: '2026-03-12T00:00:00.000Z',
    });

    const response = await disputesRoute.POST(new Request('http://localhost/api/agent-marketplace/ops/disputes', {
      method: 'POST',
      body: JSON.stringify({
        agentId: '0x00000000000000000000000000000000000000a1',
        batchHash: 'QmBatchCid',
        merkleRoot: '0x' + 'a'.repeat(64),
        requestedScore: 82,
        expectedScore: 91,
        reason: 'score mismatch',
      }),
      headers: {
        'content-type': 'application/json',
      },
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.dispute.id).toBe('disp_1');
    expect(hoisted.createDisputeMock).toHaveBeenCalledTimes(1);
  });
});
