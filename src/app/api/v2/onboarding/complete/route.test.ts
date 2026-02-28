import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { listInstances, createInstance } from '@/core/instance-registry';

vi.mock('@/core/instance-registry', () => {
  return {
    listInstances: vi.fn(async () => []),
    createInstance: vi.fn(async () => ({ instanceId: 'inst-xyz' })),
    updateInstance: vi.fn(async () => undefined),
  };
});

vi.mock('@/core/collectors/connection-validator', () => {
  return {
    validateRpcConnection: vi.fn(async () => ({ valid: true, checks: [], totalLatencyMs: 1, clientVersion: 'Geth/x', chainId: 10 })),
    validateBeaconConnection: vi.fn(async () => ({ valid: true, checks: [], totalLatencyMs: 1, clientVersion: 'Lighthouse/x' })),
  };
});

const redisSet = vi.fn(async () => 'OK');
vi.mock('@/core/redis', () => {
  return {
    getCoreRedis: () => ({ set: redisSet }),
  };
});

import { POST } from './route';

describe('v2 onboarding complete (integration-ish)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns instanceId + mappedCapabilities, persists to redis', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) as { method: string } : null;
        const method = body?.method;
        if (method === 'web3_clientVersion') {
          return new Response(JSON.stringify({ result: 'Geth/v1.0.0' }), { status: 200 });
        }
        if (method === 'eth_chainId') {
          return new Response(JSON.stringify({ result: '0xa' }), { status: 200 });
        }
        if (method === 'eth_syncing') {
          return new Response(JSON.stringify({ result: false }), { status: 200 });
        }
        if (method === 'net_peerCount') {
          return new Response(JSON.stringify({ result: '0x1' }), { status: 200 });
        }
        if (method === 'txpool_status') {
          return new Response(JSON.stringify({ result: { pending: '0x0', queued: '0x0' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { message: 'Method not found' } }), { status: 200 });
      })
    );

    const req = new NextRequest('http://localhost/api/v2/onboarding/complete', {
      method: 'POST',
      body: JSON.stringify({
        nodeType: 'ethereum-el',
        connectionConfig: { rpcUrl: 'http://mock' },
        operatorId: 'default',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json() as { data: { instanceId: string; mappedCapabilities: unknown } };
    expect(json.data.instanceId).toBe('inst-xyz');
    expect(json.data.mappedCapabilities).toBeTruthy();
    expect(redisSet).toHaveBeenCalled();
  });

  it('reuses existing instance for same protocol + normalized endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) as { method: string } : null;
        const method = body?.method;
        if (method === 'web3_clientVersion') {
          return new Response(JSON.stringify({ result: 'Geth/v1.0.0' }), { status: 200 });
        }
        if (method === 'eth_chainId') {
          return new Response(JSON.stringify({ result: '0xa' }), { status: 200 });
        }
        if (method === 'eth_syncing') {
          return new Response(JSON.stringify({ result: false }), { status: 200 });
        }
        if (method === 'net_peerCount') {
          return new Response(JSON.stringify({ result: '0x1' }), { status: 200 });
        }
        if (method === 'txpool_status') {
          return new Response(JSON.stringify({ result: { pending: '0x0', queued: '0x0' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { message: 'Method not found' } }), { status: 200 });
      })
    );

    vi.mocked(listInstances).mockResolvedValueOnce([
      {
        instanceId: 'inst-existing',
        operatorId: 'default',
        protocolId: 'opstack-l2',
        displayName: 'Existing',
        connectionConfig: { rpcUrl: 'http://mock' },
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const req = new NextRequest('http://localhost/api/v2/onboarding/complete', {
      method: 'POST',
      body: JSON.stringify({
        nodeType: 'opstack-l2',
        connectionConfig: { rpcUrl: 'HTTP://MOCK/' },
        operatorId: 'default',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json() as { data: { instanceId: string } };
    expect(json.data.instanceId).toBe('inst-existing');
    expect(createInstance).not.toHaveBeenCalled();
  });
});
