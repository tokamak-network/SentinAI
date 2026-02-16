/**
 * Tests for L1 RPC Cache
 * Validates caching behavior for L1 block numbers and EOA balances
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getCachedL1BlockNumber,
  getCachedEOABalance,
  invalidateEOABalanceCache,
  clearL1Cache,
  getL1CacheStats,
} from '@/lib/l1-rpc-cache';

describe('L1 RPC Cache', () => {
  beforeEach(() => {
    clearL1Cache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearL1Cache();
  });

  // ============================================================
  // getCachedL1BlockNumber Tests
  // ============================================================

  describe('getCachedL1BlockNumber', () => {
    it('should fetch and cache on first call', async () => {
      const fetchFn = vi.fn(async () => BigInt(12345));

      const result1 = await getCachedL1BlockNumber(fetchFn);
      expect(result1).toBe(BigInt(12345));
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('should return cached value within TTL (6 seconds)', async () => {
      const fetchFn = vi.fn(async () => BigInt(12345));

      // First call: fetch
      const result1 = await getCachedL1BlockNumber(fetchFn);
      expect(result1).toBe(BigInt(12345));
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Second call: cached (within TTL)
      const result2 = await getCachedL1BlockNumber(fetchFn);
      expect(result2).toBe(BigInt(12345));
      expect(fetchFn).toHaveBeenCalledTimes(1); // No additional fetch
    });

    it('should refetch after TTL expires', async () => {
      vi.useFakeTimers();
      const fetchFn = vi.fn(async () => BigInt(12345));

      // First call
      await getCachedL1BlockNumber(fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Advance time: 6.1 seconds (beyond TTL)
      vi.advanceTimersByTime(6100);

      // Should refetch
      await getCachedL1BlockNumber(fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should handle fetch errors gracefully', async () => {
      const error = new Error('RPC error');
      const fetchFn = vi.fn(async () => {
        throw error;
      });

      await expect(getCachedL1BlockNumber(fetchFn)).rejects.toThrow('RPC error');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('should not cache failed fetches', async () => {
      const fetchFn = vi.fn();

      // First call: fail
      fetchFn.mockRejectedValueOnce(new Error('Network error'));
      await expect(getCachedL1BlockNumber(fetchFn)).rejects.toThrow();

      // Second call: should retry (not use failed cache)
      fetchFn.mockResolvedValueOnce(BigInt(54321));
      const result = await getCachedL1BlockNumber(fetchFn);
      expect(result).toBe(BigInt(54321));
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // getCachedEOABalance Tests
  // ============================================================

  describe('getCachedEOABalance', () => {
    const testAddress = '0x1234567890123456789012345678901234567890';
    const balanceWei = BigInt('1000000000000000000'); // 1 ETH

    it('should fetch and cache on first call', async () => {
      const fetchFn = vi.fn(async () => balanceWei);

      const result = await getCachedEOABalance(testAddress, fetchFn);
      expect(result).toBe(balanceWei);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('should return cached balance within TTL (5 minutes)', async () => {
      const fetchFn = vi.fn(async () => balanceWei);

      // First call: fetch
      const result1 = await getCachedEOABalance(testAddress, fetchFn);
      expect(result1).toBe(balanceWei);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Second call: cached
      const result2 = await getCachedEOABalance(testAddress, fetchFn);
      expect(result2).toBe(balanceWei);
      expect(fetchFn).toHaveBeenCalledTimes(1); // No additional fetch
    });

    it('should refetch after TTL expires (5 minutes)', async () => {
      vi.useFakeTimers();
      const fetchFn = vi.fn(async () => balanceWei);

      // First call
      await getCachedEOABalance(testAddress, fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Advance time: 5 minutes + 1 second
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      // Should refetch
      await getCachedEOABalance(testAddress, fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should cache multiple addresses independently', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';
      const balance1 = BigInt('1000000000000000000');
      const balance2 = BigInt('2000000000000000000');

      const fetchFn1 = vi.fn(async () => balance1);
      const fetchFn2 = vi.fn(async () => balance2);

      // Cache both addresses
      const result1 = await getCachedEOABalance(address1, fetchFn1);
      const result2 = await getCachedEOABalance(address2, fetchFn2);

      expect(result1).toBe(balance1);
      expect(result2).toBe(balance2);
      expect(fetchFn1).toHaveBeenCalledTimes(1);
      expect(fetchFn2).toHaveBeenCalledTimes(1);

      // Verify cache works for both
      await getCachedEOABalance(address1, fetchFn1);
      await getCachedEOABalance(address2, fetchFn2);
      expect(fetchFn1).toHaveBeenCalledTimes(1); // No additional call
      expect(fetchFn2).toHaveBeenCalledTimes(1); // No additional call
    });

    it('should be case-insensitive for addresses', async () => {
      const addressUpper = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const addressLower = addressUpper.toLowerCase();

      const fetchFn = vi.fn(async () => balanceWei);

      // Cache with uppercase
      await getCachedEOABalance(addressUpper, fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Retrieve with lowercase should hit cache
      await getCachedEOABalance(addressLower, fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1); // No additional fetch
    });

    it('should handle large balances correctly', async () => {
      const largeBalance = BigInt('999999999999999999999999999'); // Large amount
      const fetchFn = vi.fn(async () => largeBalance);

      const result = await getCachedEOABalance(testAddress, fetchFn);
      expect(result).toBe(largeBalance);
    });

    it('should handle zero balance', async () => {
      const zeroBalance = BigInt(0);
      const fetchFn = vi.fn(async () => zeroBalance);

      const result1 = await getCachedEOABalance(testAddress, fetchFn);
      expect(result1).toBe(zeroBalance);

      // Should still be cached
      const result2 = await getCachedEOABalance(testAddress, fetchFn);
      expect(result2).toBe(zeroBalance);
      expect(fetchFn).toHaveBeenCalledTimes(1); // Cached
    });
  });

  // ============================================================
  // invalidateEOABalanceCache Tests
  // ============================================================

  describe('invalidateEOABalanceCache', () => {
    const testAddress = '0x1234567890123456789012345678901234567890';
    const balanceWei = BigInt('1000000000000000000');

    it('should remove address from cache', async () => {
      const fetchFn = vi.fn(async () => balanceWei);

      // Cache address
      await getCachedEOABalance(testAddress, fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Invalidate
      invalidateEOABalanceCache(testAddress);

      // Should refetch
      await getCachedEOABalance(testAddress, fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('should be case-insensitive', async () => {
      const addressUpper = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const addressLower = addressUpper.toLowerCase();
      const fetchFn = vi.fn(async () => balanceWei);

      // Cache with uppercase
      await getCachedEOABalance(addressUpper, fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Invalidate with lowercase
      invalidateEOABalanceCache(addressLower);

      // Should refetch (cache was invalidated)
      await getCachedEOABalance(addressUpper, fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('should not error when invalidating non-existent address', () => {
      const nonExistentAddress = '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
      expect(() => invalidateEOABalanceCache(nonExistentAddress)).not.toThrow();
    });

    it('should only invalidate specified address', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';
      const balance1 = BigInt('1000000000000000000');
      const balance2 = BigInt('2000000000000000000');

      const fetchFn1 = vi.fn(async () => balance1);
      const fetchFn2 = vi.fn(async () => balance2);

      // Cache both
      await getCachedEOABalance(address1, fetchFn1);
      await getCachedEOABalance(address2, fetchFn2);

      // Invalidate only address1
      invalidateEOABalanceCache(address1);

      // address1 should refetch
      await getCachedEOABalance(address1, fetchFn1);
      expect(fetchFn1).toHaveBeenCalledTimes(2);

      // address2 should still be cached
      await getCachedEOABalance(address2, fetchFn2);
      expect(fetchFn2).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // clearL1Cache Tests
  // ============================================================

  describe('clearL1Cache', () => {
    it('should clear all cache entries', async () => {
      const fetchFn = vi.fn(async () => BigInt(12345));
      const address = '0x1234567890123456789012345678901234567890';
      const balanceFn = vi.fn(async () => BigInt('1000000000000000000'));

      // Cache some data
      await getCachedL1BlockNumber(fetchFn);
      await getCachedEOABalance(address, balanceFn);

      expect(getL1CacheStats()).toEqual({
        l1BlockNumberCached: true,
        eoaBalancesCached: 1,
      });

      // Clear
      clearL1Cache();

      // Stats should be empty
      expect(getL1CacheStats()).toEqual({
        l1BlockNumberCached: false,
        eoaBalancesCached: 0,
      });
    });
  });

  // ============================================================
  // getL1CacheStats Tests
  // ============================================================

  describe('getL1CacheStats', () => {
    it('should return cache statistics', async () => {
      const fetchFn = vi.fn(async () => BigInt(12345));
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';
      const balanceFn = vi.fn(async () => BigInt('1000000000000000000'));

      // Initially empty
      expect(getL1CacheStats()).toEqual({
        l1BlockNumberCached: false,
        eoaBalancesCached: 0,
      });

      // Cache block number
      await getCachedL1BlockNumber(fetchFn);
      expect(getL1CacheStats()).toEqual({
        l1BlockNumberCached: true,
        eoaBalancesCached: 0,
      });

      // Cache first address
      await getCachedEOABalance(address1, balanceFn);
      expect(getL1CacheStats()).toEqual({
        l1BlockNumberCached: true,
        eoaBalancesCached: 1,
      });

      // Cache second address
      await getCachedEOABalance(address2, balanceFn);
      expect(getL1CacheStats()).toEqual({
        l1BlockNumberCached: true,
        eoaBalancesCached: 2,
      });
    });

    it('should reflect invalidations', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const balanceFn = vi.fn(async () => BigInt('1000000000000000000'));

      await getCachedEOABalance(address, balanceFn);
      expect(getL1CacheStats().eoaBalancesCached).toBe(1);

      invalidateEOABalanceCache(address);
      expect(getL1CacheStats().eoaBalancesCached).toBe(0);
    });
  });
});
