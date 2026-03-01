import { describe, expect, it } from 'vitest';
import {
  getZkstackRpcMethodMap,
  normalizeZkstackRpcSnapshot,
  resolveZkstackMode,
} from '@/chains/zkstack/rpc';

describe('zkstack rpc mapping', () => {
  it('should resolve mode safely with legacy fallback', () => {
    expect(resolveZkstackMode('legacy-era')).toBe('legacy-era');
    expect(resolveZkstackMode('os-preview')).toBe('os-preview');
    expect(resolveZkstackMode('unknown')).toBe('legacy-era');
    expect(resolveZkstackMode(undefined)).toBe('legacy-era');
  });

  it('should include zks_* settlement/proof methods', () => {
    const methodMap = getZkstackRpcMethodMap('legacy-era');

    expect(methodMap.required).toContain('eth_blockNumber');
    expect(methodMap.settlement).toContain('zks_L1BatchNumber');
    expect(methodMap.proof).toContain('zks_getL1BatchDetails');
  });

  it('should normalize zkstack snapshot numbers', () => {
    const snapshot = normalizeZkstackRpcSnapshot({
      eth_blockNumber: '0x64',
      zks_L1BatchNumber: '101',
      zks_getL1BatchDetails: {
        timestamp: '0x10',
        l1TxCount: 7,
      },
    });

    expect(snapshot.latestBlockNumber).toBe(100);
    expect(snapshot.l1BatchNumber).toBe(101);
    expect(snapshot.l1BatchTimestamp).toBe(16);
    expect(snapshot.l1TxCount).toBe(7);
  });

  it('should stay null-safe for missing zks payloads', () => {
    const snapshot = normalizeZkstackRpcSnapshot({
      eth_blockNumber: '0x1a',
    });

    expect(snapshot.latestBlockNumber).toBe(26);
    expect(snapshot.l1BatchNumber).toBeNull();
    expect(snapshot.l1BatchTimestamp).toBeNull();
    expect(snapshot.l1TxCount).toBeNull();
  });
});
