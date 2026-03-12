import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  updateDisputeStatusMock: vi.fn(),
}));

vi.mock('@/lib/agent-marketplace/dispute-store', () => ({
  updateAgentMarketplaceDisputeStatus: hoisted.updateDisputeStatusMock,
}));

const disputeRoute = await import('@/app/api/agent-marketplace/ops/disputes/[id]/route');

describe('/api/agent-marketplace/ops/disputes/[id]', () => {
  it('updates dispute status', async () => {
    hoisted.updateDisputeStatusMock.mockResolvedValue({
      id: 'disp_1',
      agentId: '0x00000000000000000000000000000000000000a1',
      batchHash: 'QmBatchCid',
      merkleRoot: '0x' + 'a'.repeat(64),
      requestedScore: 82,
      expectedScore: 91,
      reason: 'score mismatch',
      status: 'reviewed',
      createdAt: '2026-03-12T00:00:00.000Z',
      updatedAt: '2026-03-12T00:10:00.000Z',
    });

    const response = await disputeRoute.PATCH(
      new Request('http://localhost/api/agent-marketplace/ops/disputes/disp_1', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'reviewed',
        }),
        headers: {
          'content-type': 'application/json',
        },
      }),
      {
        params: Promise.resolve({ id: 'disp_1' }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dispute.status).toBe('reviewed');
    expect(hoisted.updateDisputeStatusMock).toHaveBeenCalledWith('disp_1', 'reviewed');
  });
});
