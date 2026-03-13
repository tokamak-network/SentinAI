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
      reviewedBy: 'ops@sentinai',
      reviewerNote: 'validated against latest SLA snapshot',
      history: [
        {
          fromStatus: 'open',
          toStatus: 'reviewed',
          reviewedBy: 'ops@sentinai',
          reviewerNote: 'validated against latest SLA snapshot',
          changedAt: '2026-03-12T00:10:00.000Z',
        },
      ],
      createdAt: '2026-03-12T00:00:00.000Z',
      updatedAt: '2026-03-12T00:10:00.000Z',
    });

    const response = await disputeRoute.PATCH(
      new Request('http://localhost/api/agent-marketplace/ops/disputes/disp_1', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'reviewed',
          reviewedBy: 'ops@sentinai',
          reviewerNote: 'validated against latest SLA snapshot',
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
    expect(body.dispute.reviewedBy).toBe('ops@sentinai');
    expect(body.dispute.history).toHaveLength(1);
    expect(hoisted.updateDisputeStatusMock).toHaveBeenCalledWith('disp_1', 'reviewed', {
      reviewedBy: 'ops@sentinai',
      reviewerNote: 'validated against latest SLA snapshot',
    });
  });

  it('accepts form submissions and redirects back to the selected dispute', async () => {
    hoisted.updateDisputeStatusMock.mockResolvedValue({
      id: 'disp_1',
      agentId: '0x00000000000000000000000000000000000000a1',
      batchHash: 'QmBatchCid',
      merkleRoot: '0x' + 'a'.repeat(64),
      requestedScore: 82,
      expectedScore: 91,
      reason: 'score mismatch',
      status: 'resolved',
      reviewedBy: 'ops@sentinai',
      reviewerNote: 'Closed after manual verification',
      history: [
        {
          fromStatus: 'open',
          toStatus: 'resolved',
          reviewedBy: 'ops@sentinai',
          reviewerNote: 'Closed after manual verification',
          changedAt: '2026-03-12T00:15:00.000Z',
        },
      ],
      createdAt: '2026-03-12T00:00:00.000Z',
      updatedAt: '2026-03-12T00:15:00.000Z',
    });

    const formData = new FormData();
    formData.set('status', 'resolved');
    formData.set('reviewedBy', 'ops@sentinai');
    formData.set('reviewerNote', 'Closed after manual verification');
    formData.set('redirectTo', '/v2/marketplace?dispute=disp_1');

    const response = await disputeRoute.POST(
      new Request('http://localhost/api/agent-marketplace/ops/disputes/disp_1', {
        method: 'POST',
        body: formData,
      }),
      {
        params: Promise.resolve({ id: 'disp_1' }),
      }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/v2/marketplace?dispute=disp_1');
    expect(hoisted.updateDisputeStatusMock).toHaveBeenCalledWith('disp_1', 'resolved', {
      reviewedBy: 'ops@sentinai',
      reviewerNote: 'Closed after manual verification',
    });
  });
});
