import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstRunBootstrap } from '@/lib/first-run-bootstrap';
import { listInstances } from '@/core/instance-registry';

vi.mock('@/core/redis', () => ({
  getCoreRedis: () => null,
}));

describe('firstRunBootstrap integration (self-hosted style)', () => {
  beforeEach(() => {
    delete process.env.L2_RPC_URL;
    delete process.env.SENTINAI_L2_RPC_URL;
    delete process.env.SENTINAI_L1_RPC_URL;
    delete process.env.L1_RPC_URL;
    delete process.env.CL_BEACON_URL;
    delete process.env.SENTINAI_L1_BEACON_URL;

    const g = globalThis as typeof globalThis & {
      __sentinai_instance_registry?: Map<string, unknown>;
    };
    g.__sentinai_instance_registry?.clear();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as { method?: string }) : null;
        const method = body?.method;

        if (method === 'eth_blockNumber') {
          return new Response(JSON.stringify({ result: '0x1' }), { status: 200 });
        }
        if (method === 'web3_clientVersion') {
          return new Response(JSON.stringify({ result: 'op-geth/v1.101' }), { status: 200 });
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
  });

  it('creates active instance on first run and reuses it on second run', async () => {
    process.env.L2_RPC_URL = 'HTTP://mock-rpc/';

    const first = await firstRunBootstrap({ operatorId: 'default' });
    expect(first.ok).toBe(true);
    expect(first.instanceId).toBeTruthy();
    expect(first.protocolId).toBe('opstack-l2');

    const firstList = await listInstances('default');
    expect(firstList).toHaveLength(1);
    expect(firstList[0]?.status).toBe('active');

    const second = await firstRunBootstrap({ operatorId: 'default' });
    expect(second.ok).toBe(true);
    expect(second.instanceId).toBe(first.instanceId);

    const secondList = await listInstances('default');
    expect(secondList).toHaveLength(1);
  });
});
