import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES } from '@/lib/client-profile';

describe('BUILTIN_PROFILES', () => {
  it('geth: uses txpool_status for txPool', () => {
    expect(BUILTIN_PROFILES['geth'].methods.txPool?.method).toBe('txpool_status');
    expect(BUILTIN_PROFILES['geth'].parsers.txPool).toBe('txpool');
    expect(BUILTIN_PROFILES['geth'].capabilities.supportsL2SyncStatus).toBe(false);
  });

  it('reth: uses txpool_status for txPool', () => {
    expect(BUILTIN_PROFILES['reth'].methods.txPool?.method).toBe('txpool_status');
  });

  it('nethermind: uses parity_pendingTransactions for txPool', () => {
    expect(BUILTIN_PROFILES['nethermind'].methods.txPool?.method).toBe('parity_pendingTransactions');
    expect(BUILTIN_PROFILES['nethermind'].parsers.txPool).toBe('parity');
    expect(BUILTIN_PROFILES['nethermind'].parsers.syncStatus.type).toBe('nethermind');
  });

  it('op-geth: l2SyncStatus method is optimism_syncStatus', () => {
    expect(BUILTIN_PROFILES['op-geth'].methods.l2SyncStatus?.method).toBe('optimism_syncStatus');
    expect(BUILTIN_PROFILES['op-geth'].capabilities.supportsL2SyncStatus).toBe(true);
  });

  it('nitro-node: l2SyncStatus method is arb_getL1BlockNumber', () => {
    expect(BUILTIN_PROFILES['nitro-node'].methods.l2SyncStatus?.method).toBe('arb_getL1BlockNumber');
    expect(BUILTIN_PROFILES['nitro-node'].capabilities.supportsL2SyncStatus).toBe(true);
    expect(BUILTIN_PROFILES['nitro-node'].parsers.syncStatus.type).toBe('nitro');
  });

  it('all built-in profiles have required method fields', () => {
    const required = ['blockNumber', 'syncStatus', 'gasPrice', 'chainId'] as const;
    for (const [family, profile] of Object.entries(BUILTIN_PROFILES)) {
      for (const field of required) {
        expect(profile.methods[field].method, `${family}.methods.${field}.method`).toBeTruthy();
      }
    }
  });

  it('L1 clients have null l2SyncStatus', () => {
    for (const family of ['geth', 'reth', 'nethermind', 'besu', 'erigon'] as const) {
      expect(BUILTIN_PROFILES[family].methods.l2SyncStatus, family).toBeNull();
    }
  });
});
