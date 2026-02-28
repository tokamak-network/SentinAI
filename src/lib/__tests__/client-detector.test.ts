import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { detectExecutionClient, detectConsensusClient } from '@/lib/client-detector';

function mockRpcFetch(handlers: Record<string, unknown>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as { method: string } : null;
    const method = body?.method;
    if (!method) return new Response(JSON.stringify({ error: { message: 'no method' } }), { status: 400 });

    if (!(method in handlers)) {
      return new Response(JSON.stringify({ error: { message: 'Method not found' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ result: handlers[method] }), { status: 200 });
  });
}

describe('client-detector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detectExecutionClient: normalizes family + probes common methods', async () => {
    const fetchMock = mockRpcFetch({
      web3_clientVersion: 'Geth/v1.14.13-stable',
      eth_chainId: '0x1',
      eth_syncing: false,
      net_peerCount: '0x2',
      admin_peers: [{ id: 1 }, { id: 2 }],
      txpool_status: { pending: '0x0', queued: '0x0' },
    });

    vi.stubGlobal('fetch', fetchMock);

    const detected = await detectExecutionClient({ rpcUrl: 'http://mock' });

    expect(detected.layer).toBe('execution');
    expect(detected.family).toBe('geth');
    expect(detected.chainId).toBe(1);
    expect(detected.syncing).toBe(false);
    expect(detected.peerCount).toBe(2);
    expect(detected.probes.web3_clientVersion).toBe(true);
    expect(detected.probes.eth_chainId).toBe(true);
    expect(detected.probes.eth_syncing).toBe(true);
    expect(detected.probes.admin_peers).toBe(true);
    expect(detected.probes.txpool_status).toBe(true);
  });

  it('detectConsensusClient: parses version + peer_count', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/eth/v1/node/version')) {
        return new Response(JSON.stringify({ data: { version: 'Lighthouse/v5.2.0' } }), { status: 200 });
      }
      if (url.endsWith('/eth/v1/node/syncing')) {
        return new Response(JSON.stringify({ data: { is_syncing: false } }), { status: 200 });
      }
      if (url.endsWith('/eth/v1/node/peer_count')) {
        return new Response(JSON.stringify({ data: { connected: '12' } }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const detected = await detectConsensusClient({ rpcUrl: 'http://beacon' });

    expect(detected.layer).toBe('consensus');
    expect(detected.family).toBe('lighthouse');
    expect(detected.syncing).toBe(false);
    expect(detected.peerCount).toBe(12);
    expect(detected.probes['/eth/v1/node/version']).toBe(true);
    expect(detected.probes['/eth/v1/node/peer_count']).toBe(true);
  });
});
