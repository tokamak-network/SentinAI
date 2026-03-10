/**
 * Unit tests for L1 node metrics collector
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DetectedClient } from '@/lib/client-detector';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeClient(
  family: DetectedClient['family'],
  txpoolNamespace: DetectedClient['txpoolNamespace'] = 'txpool'
): DetectedClient {
  return {
    layer: 'execution',
    family,
    chainId: 1,
    syncing: false,
    peerCount: 50,
    supportsL2SyncStatus: false,
    l2SyncMethod: null,
    txpoolNamespace,
    probes: {},
  };
}

describe('collectL1NodeMetrics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('collects block height and interval from eth_getBlockByNumber', async () => {
    const { collectL1NodeMetrics } = await import('@/lib/l1-node-metrics');
    const client = makeClient('geth');

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x12C57D' }) }) // eth_blockNumber
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x12C57D', timestamp: '0x6789ABCD', baseFeePerGas: '0x3B9ACA00' } }) }) // latest block
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x12C57C', timestamp: '0x6789ABC1' } }) }) // parent block (12s diff)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x32' }) }) // net_peerCount = 50
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: false }) }) // eth_syncing
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { pending: '0x64', queued: '0xA' } }) }); // txpool_status

    const metrics = await collectL1NodeMetrics('http://localhost:8545', client, 'external');

    expect(metrics.blockHeight).toBe(1230205); // 0x12C57D
    expect(metrics.blockInterval).toBe(12);
    expect(metrics.peerCount).toBe(50);
    expect(metrics.syncing).toBe(false);
    expect(metrics.syncGap).toBe(0);
    expect(metrics.txPoolPending).toBe(100); // 0x64
    expect(metrics.txPoolQueued).toBe(10);   // 0xA
    expect(metrics.cpuUsage).toBe(0);
    expect(metrics.memoryPercent).toBe(0);
  });

  it('returns txPoolPending=-1 when client has no txpool namespace', async () => {
    const { collectL1NodeMetrics } = await import('@/lib/l1-node-metrics');
    const client = makeClient('geth', null);

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x1' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x1', timestamp: '0x100', baseFeePerGas: '0x0' } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x0', timestamp: '0xF4' } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x5' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: false }) });

    const metrics = await collectL1NodeMetrics('http://localhost:8545', client, 'external');
    expect(metrics.txPoolPending).toBe(-1);
    expect(metrics.txPoolQueued).toBe(-1);
  });

  it('sets syncGap > 0 when eth_syncing returns sync progress', async () => {
    const { collectL1NodeMetrics } = await import('@/lib/l1-node-metrics');
    const client = makeClient('reth');

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x100' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x100', timestamp: '0x200', baseFeePerGas: '0x0' } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0xFF', timestamp: '0x1F4' } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x3' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
        result: { currentBlock: '0x100', highestBlock: '0x200', startingBlock: '0x0' }
      }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { pending: '0x0', queued: '0x0' } }) });

    const metrics = await collectL1NodeMetrics('http://localhost:8545', client, 'external');
    expect(metrics.syncing).toBe(true);
    expect(metrics.syncGap).toBe(256); // 0x200 - 0x100
  });

  it('returns peerCount=0 and does not throw when net_peerCount fails', async () => {
    const { collectL1NodeMetrics } = await import('@/lib/l1-node-metrics');
    const client = makeClient('geth', null);

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x1' }) }) // eth_blockNumber
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x1', timestamp: '0x10', baseFeePerGas: '0x0' } }) }) // latest block
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x0', timestamp: '0x4' } }) }) // parent
      .mockRejectedValueOnce(new Error('network error')) // net_peerCount fails
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: false }) }); // eth_syncing

    const metrics = await collectL1NodeMetrics('http://localhost:8545', client, 'external');
    expect(metrics.peerCount).toBe(0);
  });
});
