/**
 * Shared Mock RPC helpers for chain/client integration scenario tests
 * Based on docs/guide/testing/chain-client-integration-scenarios.md
 */

import { vi } from 'vitest';

/**
 * Creates a mock fetch that dispatches by JSON-RPC method name.
 * Methods not listed in `handlers` return a -32601 Method not found error.
 */
export function mockRpcFetch(handlers: Record<string, unknown>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as { method: string }) : null;
    const method = body?.method;

    if (!method) {
      return new Response(JSON.stringify({ error: { code: -32700, message: 'Parse error' } }), {
        status: 200,
      });
    }

    if (!(method in handlers)) {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }),
        { status: 200 }
      );
    }

    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: handlers[method] }),
      { status: 200 }
    );
  });
}

/**
 * Creates a URL-aware mock fetch that routes to different handlers by URL substring.
 * Usage: urlDispatchFetch({ 'geth-l1': gethHandlers, 'op-geth-l2': opGethHandlers })
 */
export function urlDispatchFetch(routes: Record<string, Record<string, unknown>>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    for (const [urlFragment, handlers] of Object.entries(routes)) {
      if (url.includes(urlFragment)) {
        const body = init?.body ? (JSON.parse(String(init.body)) as { method: string }) : null;
        const method = body?.method;

        if (!method || !(method in handlers)) {
          return new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }),
            { status: 200 }
          );
        }

        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: handlers[method] }),
          { status: 200 }
        );
      }
    }
    // No route matched → connection refused simulation
    throw new Error(`Connection refused: ${url}`);
  });
}

// ============================================================
// Common response fixtures
// ============================================================

export const FIXTURES = {
  eth: {
    synced: false,
    syncing: { currentBlock: '0x100', highestBlock: '0x200', startingBlock: '0x0' },
    blockNumber: '0x1a4',
    chainId: '0x1',
    peerCount: '0x8',
  },
  txpool: {
    status: { pending: '0xa', queued: '0x2' },
    parityPending: [{ hash: '0xabc', nonce: '0x1' }],
  },
  opSyncStatus: {
    head_l1: { hash: '0xabc', number: 19000000, timestamp: 1700000000, parentHash: '0x000' },
    safe_l1: { hash: '0xabc', number: 18999990, timestamp: 1699999900, parentHash: '0x000' },
    unsafe_l2: { hash: '0xdef', number: 100000, timestamp: 1700000010, parentHash: '0x000' },
    safe_l2: { hash: '0xdef', number: 99990, timestamp: 1699999920, parentHash: '0x000' },
    finalized_l2: { hash: '0xghi', number: 99900, timestamp: 1699998000, parentHash: '0x000' },
    engine_sync_target: { hash: '0x000', number: 0, timestamp: 0, parentHash: '0x000' },
    queued_unsafe_l2_transactions: 0,
    pending_safe_l2_blocks: 10,
  },
};
