import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  composeSequencerHealthSnapshotMock: vi.fn(),
}));

vi.mock('@/lib/agent-marketplace/sequencer-health', () => ({
  composeSequencerHealthSnapshot: hoisted.composeSequencerHealthSnapshotMock,
}));

const { GET } = await import('@/app/api/agent-marketplace/sequencer-health/route');

describe('/api/agent-marketplace/sequencer-health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MARKETPLACE_PAYMENT_MODE;
    hoisted.composeSequencerHealthSnapshotMock.mockResolvedValue({
      status: 'healthy',
      healthScore: 84,
      action: 'proceed',
      reasons: ['block interval stable'],
      window: { lookbackMinutes: 15, sampleCount: 15 },
      blockProduction: {
        latestBlockIntervalSec: 2.1,
        avgBlockIntervalSec: 2.2,
        stdDevBlockIntervalSec: 0.2,
        trend: 'stable',
        stalled: false,
      },
      sync: { lagBlocks: 0, lagTrend: 'stable', catchingUp: false },
      incident: { activeCount: 0, highestSeverity: 'none', lastIncidentAt: null },
      resources: { cpuPressure: 'normal', memoryPressure: 'normal' },
      updatedAt: '2026-03-12T00:00:00.000Z',
    });
  });

  it('returns 402 when payment header is missing', async () => {
    const response = await GET(new NextRequest('http://localhost/api/agent-marketplace/sequencer-health'));
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error.code).toBe('payment_required');
  });

  it('returns snapshot payload in open payment mode', async () => {
    process.env.MARKETPLACE_PAYMENT_MODE = 'open';
    const paymentPayload = Buffer.from(JSON.stringify({
      agentId: 'agent-123',
      scheme: 'exact',
      network: 'eip155:1',
      token: 'ton',
      amount: '100000000000000000',
      authorization: 'signed-payload',
    })).toString('base64');

    const response = await GET(new NextRequest('http://localhost/api/agent-marketplace/sequencer-health', {
      headers: { 'x-payment': paymentPayload },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(hoisted.composeSequencerHealthSnapshotMock).toHaveBeenCalledTimes(1);
    expect(body.status).toBe('healthy');
    expect(body.action).toBe('proceed');
  });
});
