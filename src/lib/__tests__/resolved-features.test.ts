import { describe, it, expect } from 'vitest';
import { resolveFeatures } from '@/lib/resolved-features';

// Minimal mocks matching the actual types
const makeDetected = (overrides = {}) => ({
  capabilities: ['block-production'] as any[],
  supportsTxPool: false,
  txpoolNamespace: null,
  supportsPeerCount: false,
  ...overrides,
});

const makeProfile = (overrides = {}) => ({
  clientFamily: 'geth',
  methods: {
    blockNumber: { method: 'eth_blockNumber' },
    syncStatus: { method: 'eth_syncing' },
    txPool: { method: 'txpool_status' },
    peerCount: { method: 'net_peerCount' },
    l2SyncStatus: null,
    gasPrice: { method: 'eth_gasPrice' },
    chainId: { method: 'eth_chainId' },
  },
  parsers: { syncStatus: { type: 'standard' as const }, txPool: 'txpool' as const },
  capabilities: {
    supportsTxPool: true,
    supportsPeerCount: true,
    supportsL2SyncStatus: false,
    supportsDebugNamespace: false,
  },
  customMetrics: [],
  ...overrides,
});

describe('resolveFeatures', () => {
  it('txpoolMonitoring: true only when both stack and runtime support it', () => {
    const result = resolveFeatures(
      makeDetected({ supportsTxPool: true }),
      makeProfile({ capabilities: { supportsTxPool: true, supportsPeerCount: false, supportsL2SyncStatus: false, supportsDebugNamespace: false } }),
    );
    expect(result.txpoolMonitoring).toBe(true);
  });

  it('txpoolMonitoring: false when runtime does not detect txpool', () => {
    const result = resolveFeatures(
      makeDetected({ supportsTxPool: false }),
      makeProfile(),
    );
    expect(result.txpoolMonitoring).toBe(false);
  });

  it('txpoolMonitoring: false when profile says no txpool support', () => {
    const result = resolveFeatures(
      makeDetected({ supportsTxPool: true }),
      makeProfile({ capabilities: { supportsTxPool: false, supportsPeerCount: true, supportsL2SyncStatus: false, supportsDebugNamespace: false } }),
    );
    expect(result.txpoolMonitoring).toBe(false);
  });

  it('peerMonitoring: reflects detected.supportsPeerCount', () => {
    const yes = resolveFeatures(makeDetected({ supportsPeerCount: true }), makeProfile());
    const no = resolveFeatures(makeDetected({ supportsPeerCount: false }), makeProfile());
    expect(yes.peerMonitoring).toBe(true);
    expect(no.peerMonitoring).toBe(false);
  });

  it('l2SyncMonitoring: reflects profile.capabilities.supportsL2SyncStatus', () => {
    const yes = resolveFeatures(
      makeDetected(),
      makeProfile({ capabilities: { supportsTxPool: false, supportsPeerCount: false, supportsL2SyncStatus: true, supportsDebugNamespace: false } }),
    );
    expect(yes.l2SyncMonitoring).toBe(true);
  });

  it('customMetricsCount: reflects profile.customMetrics.length', () => {
    const result = resolveFeatures(
      makeDetected(),
      makeProfile({ customMetrics: [{ name: 'a', displayName: 'A', method: 'm', responsePath: 'r' }] }),
    );
    expect(result.customMetricsCount).toBe(1);
  });

  it('partialSupport: true when clientFamily is unknown', () => {
    const result = resolveFeatures(
      makeDetected(),
      makeProfile({ clientFamily: 'unknown' }),
    );
    expect(result.partialSupport).toBe(true);
  });

  it('partialSupport: false for known clients', () => {
    const result = resolveFeatures(makeDetected(), makeProfile({ clientFamily: 'geth' }));
    expect(result.partialSupport).toBe(false);
  });
});
