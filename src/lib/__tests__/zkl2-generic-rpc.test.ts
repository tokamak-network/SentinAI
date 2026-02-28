import { describe, expect, it } from 'vitest';
import {
  getZkL2RpcMethodMap,
  normalizeZkL2RpcSnapshot,
  resolveZkL2Network,
} from '@/chains/zkl2-generic/rpc';

describe('zkl2-generic rpc mapping', () => {
  it('should resolve aliases to canonical network id', () => {
    expect(resolveZkL2Network('scroll')).toBe('scroll');
    expect(resolveZkL2Network('linea')).toBe('linea');
    expect(resolveZkL2Network('polygon-zkevm')).toBe('polygon-zkevm');
    expect(resolveZkL2Network('zkevm')).toBe('polygon-zkevm');
    expect(resolveZkL2Network('unknown-chain')).toBe('zkl2-generic');
  });

  it('should include base required methods for all networks', () => {
    const scrollMap = getZkL2RpcMethodMap('scroll');
    const lineaMap = getZkL2RpcMethodMap('linea');

    for (const requiredMethod of ['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_syncing']) {
      expect(scrollMap.required).toContain(requiredMethod);
      expect(lineaMap.required).toContain(requiredMethod);
    }
  });

  it('should expose network-specific methods for polygon-zkevm', () => {
    const methodMap = getZkL2RpcMethodMap('polygon-zkevm');

    expect(methodMap.settlement).toContain('zkevm_batchNumber');
    expect(methodMap.settlement).toContain('zkevm_virtualBatchNumber');
    expect(methodMap.proof).toContain('zkevm_verifiedBatchNumber');
  });

  it('should normalize polygon-zkevm rpc snapshot numbers', () => {
    const snapshot = normalizeZkL2RpcSnapshot('zkevm', {
      eth_blockNumber: '0x64',
      zkevm_batchNumber: '101',
      zkevm_virtualBatchNumber: '0x70',
      zkevm_verifiedBatchNumber: 95,
    });

    expect(snapshot.latestBlockNumber).toBe(100);
    expect(snapshot.settlementBatchNumber).toBe(101);
    expect(snapshot.virtualBatchNumber).toBe(112);
    expect(snapshot.verifiedBatchNumber).toBe(95);
  });

  it('should remain null-safe for non-zkevm networks', () => {
    const snapshot = normalizeZkL2RpcSnapshot('scroll', {
      eth_blockNumber: '0x1a',
    });

    expect(snapshot.latestBlockNumber).toBe(26);
    expect(snapshot.settlementBatchNumber).toBeNull();
    expect(snapshot.virtualBatchNumber).toBeNull();
    expect(snapshot.verifiedBatchNumber).toBeNull();
  });
});
