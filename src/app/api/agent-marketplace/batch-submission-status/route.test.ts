import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  composeBatchSubmissionStatusSnapshotMock: vi.fn(),
}));

vi.mock('@/lib/agent-marketplace/batch-submission-status', () => ({
  composeBatchSubmissionStatusSnapshot: hoisted.composeBatchSubmissionStatusSnapshotMock,
}));

const { GET } = await import('@/app/api/agent-marketplace/batch-submission-status/route');

describe('/api/agent-marketplace/batch-submission-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MARKETPLACE_PAYMENT_MODE;
    hoisted.composeBatchSubmissionStatusSnapshotMock.mockResolvedValue({
      status: 'warning',
      lastSuccessfulSubmissionAt: '2026-03-12T00:00:00.000Z',
      submissionLagSec: 540,
      riskLevel: 'elevated',
      reasons: ['batch posting delayed'],
    });
  });

  it('returns 402 when payment header is missing', async () => {
    const response = await GET(new NextRequest('http://localhost/api/agent-marketplace/batch-submission-status'));
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error.code).toBe('payment_required');
  });

  it('returns status payload in open payment mode', async () => {
    process.env.MARKETPLACE_PAYMENT_MODE = 'open';
    const paymentPayload = Buffer.from(JSON.stringify({
      agentId: 'agent-123',
      scheme: 'exact',
      network: 'eip155:1',
      token: 'ton',
      amount: '150000000000000000',
      authorization: 'signed-payload',
    })).toString('base64');

    const response = await GET(new NextRequest('http://localhost/api/agent-marketplace/batch-submission-status', {
      headers: { 'x-payment': paymentPayload },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(hoisted.composeBatchSubmissionStatusSnapshotMock).toHaveBeenCalledTimes(1);
    expect(body.status).toBe('warning');
    expect(body.riskLevel).toBe('elevated');
  });
});
