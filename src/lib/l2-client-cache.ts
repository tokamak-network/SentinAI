/**
 * L2 Client Detection Cache
 *
 * Probing the L2 node (txpool_status, parity_pendingTransactions, etc.) is expensive —
 * multiple sequential RPC round-trips per detection. This module caches the result for
 * CACHE_TTL_MS so the observe cycle pays the probe cost only once every 10 minutes.
 */

import { detectClient } from '@/lib/client-detector';
import type { DetectedClient } from '@/lib/client-detector';

interface CacheEntry {
  detected: DetectedClient;
  cachedAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map<string, CacheEntry>();

/** Minimal unknown fallback used when probe fails — never blocks the observe cycle. */
const UNKNOWN_CLIENT: DetectedClient = {
  layer: 'execution',
  family: 'unknown',
  version: undefined,
  chainId: undefined,
  syncing: undefined,
  peerCount: undefined,
  supportsL2SyncStatus: false,
  l2SyncMethod: null,
  txpoolNamespace: null,
  probes: {},
  raw: {},
};

/**
 * Returns the cached DetectedClient for the given RPC URL, or probes the node if
 * the cache is stale/empty. Falls back to UNKNOWN_CLIENT on probe error so that
 * the observe cycle is never blocked by detection failure.
 */
export async function getOrDetectL2Client(rpcUrl: string): Promise<DetectedClient> {
  const now = Date.now();
  const entry = cache.get(rpcUrl);
  if (entry && now - entry.cachedAt < CACHE_TTL_MS) {
    return entry.detected;
  }

  try {
    const detected = await detectClient({ rpcUrl });
    cache.set(rpcUrl, { detected, cachedAt: now });
    return detected;
  } catch {
    // Return minimal fallback so the observe cycle is never blocked by probe failure
    return UNKNOWN_CLIENT;
  }
}

/** Invalidate cache entry (e.g. after client version change detected). */
export function invalidateL2ClientCache(rpcUrl: string): void {
  cache.delete(rpcUrl);
}

/** Exposed for testing only — clears the entire cache. */
export function _clearCacheForTest(): void {
  cache.clear();
}
