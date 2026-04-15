import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAgentMarketplaceCatalog } from '@/lib/agent-marketplace/catalog';
import { clearAgentMarketplaceRateLimitState } from '@/lib/agent-marketplace/rate-limit';
import {
  clearAgentMarketplaceRequestLogs,
  getAgentMarketplaceRequestLogs,
} from '@/lib/agent-marketplace/request-log-store';
import { withX402 } from '@/lib/agent-marketplace/x402-middleware';

const hoisted = vi.hoisted(() => {
  const state = new Map<string, string[]>();

  return {
    state,
    redisRpushMock: vi.fn(async (key: string, value: string) => {
      const current = state.get(key) ?? [];
      current.push(value);
      state.set(key, current);
      return current.length;
    }),
    redisLrangeMock: vi.fn(async (key: string, start: number, end: number) => {
      const current = state.get(key) ?? [];
      const normalizedEnd = end < 0 ? current.length + end + 1 : end + 1;
      return current.slice(start, normalizedEnd);
    }),
    redisDelMock: vi.fn(async (key: string) => {
      state.delete(key);
      return 1;
    }),
  };
});

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    rpush: hoisted.redisRpushMock,
    lrange: hoisted.redisLrangeMock,
    del: hoisted.redisDelMock,
  })),
}));

describe('agent-marketplace x402-middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.state.clear();
    process.env.REDIS_URL = 'redis://localhost:6379';
    delete process.env.MARKETPLACE_PAYMENT_MODE;
    delete process.env.MARKETPLACE_RATE_LIMIT_MAX_REQUESTS;
    delete process.env.MARKETPLACE_RATE_LIMIT_WINDOW_MS;
    (globalThis as typeof globalThis & {
      __sentinai_agent_marketplace_request_log_redis?: unknown;
    }).__sentinai_agent_marketplace_request_log_redis = undefined;
    clearAgentMarketplaceRateLimitState();
    return clearAgentMarketplaceRequestLogs();
  });

  it('returns 402 with accepts metadata when the payment header is missing', async () => {
    const request = new NextRequest('http://localhost/api/agent-marketplace/sequencer-health');

    const response = await withX402(
      request,
      getAgentMarketplaceCatalog().services[0],
      async () => Response.json({ ok: true })
    );
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error.code).toBe('payment_required');
    expect(body.accepts[0].amount).toBe('100000000000000000');
  });

  it('returns 402 when the payment header is invalid', async () => {
    const request = new NextRequest('http://localhost/api/agent-marketplace/sequencer-health', {
      headers: {
        'x-payment': 'invalid-header',
      },
    });

    const response = await withX402(
      request,
      getAgentMarketplaceCatalog().services[0],
      async () => Response.json({ ok: true })
    );
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error.code).toBe('invalid_payment_header');
  });

  it('allows the handler to run in open mode when payment metadata is valid', async () => {
    process.env.MARKETPLACE_PAYMENT_MODE = 'open';
    const service = getAgentMarketplaceCatalog().services[0];
    const paymentPayload = Buffer.from(JSON.stringify({
      buyer: 'agent-123',
      scheme: 'exact',
      network: 'eip155:1',
      amount: service.payment!.amount,
      signature: '0xdeadbeef',
    })).toString('base64');

    const request = new NextRequest('http://localhost/api/agent-marketplace/sequencer-health', {
      headers: {
        'x-payment': paymentPayload,
      },
    });

    const response = await withX402(
      request,
      service,
      async ({ payment }) => Response.json({
        ok: true,
        agentId: payment.agentId,
        mode: payment.mode,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.agentId).toBe('agent-123');
    expect(body.mode).toBe('open');
  });

  it('records successful and rejected requests in the request log store', async () => {
    process.env.MARKETPLACE_PAYMENT_MODE = 'open';
    const service = getAgentMarketplaceCatalog().services[0];
    const validPaymentPayload = Buffer.from(JSON.stringify({
      buyer: 'agent-123',
      scheme: 'exact',
      network: 'eip155:1',
      amount: service.payment!.amount,
      signature: '0xdeadbeef',
    })).toString('base64');

    await withX402(
      new NextRequest('http://localhost/api/agent-marketplace/sequencer-health', {
        headers: { 'x-payment': validPaymentPayload },
      }),
      service,
      async () => Response.json({ ok: true })
    );

    await withX402(
      new NextRequest('http://localhost/api/agent-marketplace/sequencer-health', {
        headers: { 'x-payment': 'invalid-header' },
      }),
      service,
      async () => Response.json({ ok: true })
    );

    const logs = await getAgentMarketplaceRequestLogs();

    expect(logs).toHaveLength(2);
    expect(logs[0].verificationResult).toBe('verified');
    expect(logs[1].verificationResult).toBe('rejected');
  });

  it('throttles requests above the configured per-agent threshold', async () => {
    process.env.MARKETPLACE_PAYMENT_MODE = 'open';
    process.env.MARKETPLACE_RATE_LIMIT_MAX_REQUESTS = '1';
    process.env.MARKETPLACE_RATE_LIMIT_WINDOW_MS = '60000';
    const service = getAgentMarketplaceCatalog().services[0];
    const paymentPayload = Buffer.from(JSON.stringify({
      buyer: 'agent-123',
      scheme: 'exact',
      network: 'eip155:1',
      amount: service.payment!.amount,
      signature: '0xdeadbeef',
    })).toString('base64');

    const firstResponse = await withX402(
      new NextRequest('http://localhost/api/agent-marketplace/sequencer-health', {
        headers: { 'x-payment': paymentPayload },
      }),
      service,
      async () => Response.json({ ok: true })
    );

    const secondResponse = await withX402(
      new NextRequest('http://localhost/api/agent-marketplace/sequencer-health', {
        headers: { 'x-payment': paymentPayload },
      }),
      service,
      async () => Response.json({ ok: true })
    );
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(429);
    expect(secondBody.error.code).toBe('rate_limited');
  });
});
