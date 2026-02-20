/**
 * L1 RPC Cache Module
 * Reduces L1 RPC call frequency by caching slowly-changing data.
 *
 * Cache TTLs:
 * - L1 Block Number: 6 seconds (half of 12s block time)
 * - EOA Balances: 5 minutes (balances change slowly)
 *
 * Impact: 120 L1 RPC calls/30s → 6 calls/30s (95% reduction)
 */

import { formatEther } from 'viem';

// ============================================================
// Cache Configuration
// ============================================================

/** L1 block number cache TTL: 6 seconds (half block time) */
const L1_BLOCK_CACHE_TTL_MS = 6_000;

/** EOA balance cache TTL: 5 minutes (balances change slowly) */
const EOA_BALANCE_CACHE_TTL_MS = 5 * 60_000;

// ============================================================
// Type Definitions
// ============================================================

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

interface L1CacheState {
  l1BlockNumber: CacheEntry<bigint> | null;
  eoaBalances: Map<string, CacheEntry<number>>;
}

// ============================================================
// Global Cache State
// ============================================================

const globalForCache = globalThis as unknown as {
  __sentinai_l1_cache?: L1CacheState;
};

function getCache(): L1CacheState {
  if (!globalForCache.__sentinai_l1_cache) {
    globalForCache.__sentinai_l1_cache = {
      l1BlockNumber: null,
      eoaBalances: new Map(),
    };
  }

  return globalForCache.__sentinai_l1_cache;
}

// ============================================================
// Public API
// ============================================================

/**
 * Get cached L1 block number or fetch if stale.
 *
 * @param fetchFn - Function to fetch L1 block number from RPC
 * @returns Cached or freshly fetched block number
 *
 * @example
 * const blockNumber = await getCachedL1BlockNumber(() => l1Client.getBlockNumber());
 */
export async function getCachedL1BlockNumber(fetchFn: () => Promise<bigint>): Promise<bigint> {
  const cache = getCache();
  const now = Date.now();

  // Check cache hit
  if (cache.l1BlockNumber && now - cache.l1BlockNumber.timestamp < L1_BLOCK_CACHE_TTL_MS) {
    console.info('[L1 Cache] Hit: L1 block number');
    return cache.l1BlockNumber.value;
  }

  // Cache miss: fetch and store
  console.info('[L1 Cache] Miss: L1 block number');
  const value = await fetchFn();
  cache.l1BlockNumber = { value, timestamp: now };
  return value;
}

/**
 * Get cached EOA balance or fetch if stale.
 *
 * Caches balance as ETH (not wei) for efficient Map storage.
 *
 * @param address - EOA address to cache (normalized to lowercase)
 * @param fetchFn - Function to fetch balance from L1 RPC (returns wei)
 * @returns Fresh or cached balance in wei
 *
 * @example
 * const balanceWei = await getCachedEOABalance(
 *   batcherAddress,
 *   () => l1Client.getBalance({ address: batcherAddress })
 * );
 */
export async function getCachedEOABalance(
  address: string,
  fetchFn: () => Promise<bigint>
): Promise<bigint> {
  const cache = getCache();
  const now = Date.now();
  const normalized = address.toLowerCase();
  const cached = cache.eoaBalances.get(normalized);

  // Check cache hit
  if (cached && now - cached.timestamp < EOA_BALANCE_CACHE_TTL_MS) {
    console.info(`[L1 Cache] Hit: EOA balance ${address.slice(0, 10)}...`);
    // Convert back from ETH to wei
    return BigInt(Math.floor(cached.value * 1e18));
  }

  // Cache miss: fetch and store
  console.info(`[L1 Cache] Miss: EOA balance ${address.slice(0, 10)}...`);
  const balanceWei = await fetchFn();
  const balanceEth = parseFloat(formatEther(balanceWei));
  cache.eoaBalances.set(normalized, { value: balanceEth, timestamp: now });
  return balanceWei;
}

/**
 * Invalidate cached EOA balance (typically after refill transaction).
 *
 * @param address - EOA address to invalidate
 */
export function invalidateEOABalanceCache(address: string): void {
  const cache = getCache();
  const normalized = address.toLowerCase();
  const wasPresent = cache.eoaBalances.delete(normalized);

  if (wasPresent) {
    console.info(`[L1 Cache] Invalidated: EOA balance ${address.slice(0, 10)}...`);
  }
}

/**
 * Clear all cache entries (for testing).
 */
export function clearL1Cache(): void {
  globalForCache.__sentinai_l1_cache = undefined;
  console.info('[L1 Cache] Cleared all cache');
}

/**
 * Get cache statistics (for monitoring).
 *
 * @returns Object with cache hit counts
 */
export function getL1CacheStats() {
  const cache = getCache();
  return {
    l1BlockNumberCached: cache.l1BlockNumber !== null,
    eoaBalancesCached: cache.eoaBalances.size,
  };
}
