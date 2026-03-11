/**
 * L2 Client Cache Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/client-detector', () => ({
  detectClient: vi.fn(),
}));

import { getOrDetectL2Client, invalidateL2ClientCache, _clearCacheForTest } from '@/lib/l2-client-cache';
import { detectClient } from '@/lib/client-detector';
import type { DetectedClient } from '@/lib/client-detector';

const MOCK_DETECTED: DetectedClient = {
  layer: 'execution',
  family: 'geth',
  version: 'Geth/v1.13.0',
  chainId: 1,
  syncing: false,
  peerCount: 5,
  supportsL2SyncStatus: false,
  l2SyncMethod: null,
  txpoolNamespace: 'txpool',
  probes: { txpool_status: true },
  raw: {},
};

const PARITY_DETECTED: DetectedClient = {
  layer: 'execution',
  family: 'nethermind',
  version: 'Nethermind/v1.20.0',
  chainId: 1,
  syncing: false,
  peerCount: 3,
  supportsL2SyncStatus: false,
  l2SyncMethod: null,
  txpoolNamespace: 'parity',
  probes: { parity_pendingTransactions: true },
  raw: {},
};

describe('l2-client-cache', () => {
  beforeEach(() => {
    _clearCacheForTest();
    vi.clearAllMocks();
  });

  afterEach(() => {
    _clearCacheForTest();
  });

  describe('getOrDetectL2Client', () => {
    it('calls detectClient on first call and caches result', async () => {
      vi.mocked(detectClient).mockResolvedValueOnce(MOCK_DETECTED);

      const result = await getOrDetectL2Client('http://rpc:8545');

      expect(detectClient).toHaveBeenCalledTimes(1);
      expect(detectClient).toHaveBeenCalledWith({ rpcUrl: 'http://rpc:8545' });
      expect(result.txpoolNamespace).toBe('txpool');
    });

    it('returns cached result on second call without calling detectClient again', async () => {
      vi.mocked(detectClient).mockResolvedValueOnce(MOCK_DETECTED);

      await getOrDetectL2Client('http://rpc:8545');
      const second = await getOrDetectL2Client('http://rpc:8545');

      expect(detectClient).toHaveBeenCalledTimes(1);
      expect(second.txpoolNamespace).toBe('txpool');
    });

    it('caches results per rpcUrl independently', async () => {
      vi.mocked(detectClient)
        .mockResolvedValueOnce(MOCK_DETECTED)
        .mockResolvedValueOnce(PARITY_DETECTED);

      const a = await getOrDetectL2Client('http://rpc-a:8545');
      const b = await getOrDetectL2Client('http://rpc-b:8545');

      expect(detectClient).toHaveBeenCalledTimes(2);
      expect(a.txpoolNamespace).toBe('txpool');
      expect(b.txpoolNamespace).toBe('parity');
    });

    it('re-probes after TTL expiry', async () => {
      vi.mocked(detectClient).mockResolvedValue(MOCK_DETECTED);

      // First call populates cache
      await getOrDetectL2Client('http://rpc:8545');
      expect(detectClient).toHaveBeenCalledTimes(1);

      // Advance time by 11 minutes to expire the cache
      const realDateNow = Date.now;
      Date.now = vi.fn().mockReturnValue(realDateNow() + 11 * 60 * 1000);

      try {
        await getOrDetectL2Client('http://rpc:8545');
        expect(detectClient).toHaveBeenCalledTimes(2);
      } finally {
        Date.now = realDateNow;
      }
    });

    it('returns unknown fallback when detectClient throws', async () => {
      vi.mocked(detectClient).mockRejectedValueOnce(new Error('connection refused'));

      const result = await getOrDetectL2Client('http://unreachable:8545');

      expect(result.txpoolNamespace).toBeNull();
      expect(result.family).toBe('unknown');
      expect(result.supportsL2SyncStatus).toBe(false);
    });

    it('unknown fallback is not cached — next call retries detection', async () => {
      vi.mocked(detectClient)
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(MOCK_DETECTED);

      const first = await getOrDetectL2Client('http://rpc:8545');
      expect(first.family).toBe('unknown');

      const second = await getOrDetectL2Client('http://rpc:8545');
      // Second call should retry since the error path doesn't cache
      // detectClient called twice total
      expect(detectClient).toHaveBeenCalledTimes(2);
      expect(second.txpoolNamespace).toBe('txpool');
    });
  });

  describe('invalidateL2ClientCache', () => {
    it('removes cache entry so next call re-probes', async () => {
      vi.mocked(detectClient).mockResolvedValue(MOCK_DETECTED);

      await getOrDetectL2Client('http://rpc:8545');
      expect(detectClient).toHaveBeenCalledTimes(1);

      invalidateL2ClientCache('http://rpc:8545');

      await getOrDetectL2Client('http://rpc:8545');
      expect(detectClient).toHaveBeenCalledTimes(2);
    });

    it('only removes the specified entry, not others', async () => {
      vi.mocked(detectClient).mockResolvedValue(MOCK_DETECTED);

      await getOrDetectL2Client('http://rpc-a:8545');
      await getOrDetectL2Client('http://rpc-b:8545');
      expect(detectClient).toHaveBeenCalledTimes(2);

      invalidateL2ClientCache('http://rpc-a:8545');

      // rpc-b still cached, rpc-a re-probes
      await getOrDetectL2Client('http://rpc-b:8545');
      expect(detectClient).toHaveBeenCalledTimes(2); // no new call for b

      await getOrDetectL2Client('http://rpc-a:8545');
      expect(detectClient).toHaveBeenCalledTimes(3); // new call for a
    });
  });
});
