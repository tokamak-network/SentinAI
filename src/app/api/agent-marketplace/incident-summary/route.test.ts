import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  composeIncidentSummarySnapshotMock: vi.fn(),
}));

vi.mock('@/lib/agent-marketplace/incident-summary', () => ({
  composeIncidentSummarySnapshot: hoisted.composeIncidentSummarySnapshotMock,
}));

const { GET } = await import('@/app/api/agent-marketplace/incident-summary/route');

describe('/api/agent-marketplace/incident-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MARKETPLACE_PAYMENT_MODE;
    hoisted.composeIncidentSummarySnapshotMock.mockResolvedValue({
      status: 'degraded',
      activeCount: 1,
      highestSeverity: 'high',
      unresolvedCount: 1,
      lastIncidentAt: '2026-03-12T00:00:00.000Z',
      rollingWindow: { lookbackHours: 24, incidentCount: 3, mttrMinutes: 18 },
    });
  });

  it('returns 402 when payment header is missing', async () => {
    const response = await GET(new NextRequest('http://localhost/api/agent-marketplace/incident-summary'));
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error.code).toBe('payment_required');
  });

  it('returns summary payload in open payment mode', async () => {
    process.env.MARKETPLACE_PAYMENT_MODE = 'open';
    const paymentPayload = Buffer.from(JSON.stringify({
      buyer: 'agent-123',
      scheme: 'exact',
      network: 'eip155:1',
      token: 'ton',
      amount: '150000000000000000',
      signature: '0xdeadbeef',
    })).toString('base64');

    const response = await GET(new NextRequest('http://localhost/api/agent-marketplace/incident-summary', {
      headers: { 'x-payment': paymentPayload },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(hoisted.composeIncidentSummarySnapshotMock).toHaveBeenCalledTimes(1);
    expect(body.status).toBe('degraded');
    expect(body.highestSeverity).toBe('high');
  });
});
