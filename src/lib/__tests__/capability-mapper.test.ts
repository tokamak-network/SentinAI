import { describe, expect, it } from 'vitest';
import { mapDetectedClientToCapabilities } from '@/lib/capability-mapper';
import type { DetectedClient } from '@/lib/client-detector';

describe('capability-mapper', () => {
  it('maps execution client probes into txpool/peer/sync capabilities', () => {
    const detected: DetectedClient = {
      layer: 'execution',
      family: 'geth',
      version: 'Geth/v1.0.0',
      supportsL2SyncStatus: false,
      l2SyncMethod: null,
      txpoolNamespace: 'txpool',
      probes: {
        eth_syncing: true,
        admin_peers: true,
        txpool_status: true,
      },
    };

    const mapped = mapDetectedClientToCapabilities(detected, 'ethereum-el');
    expect(mapped.supportsTxPool).toBe(true);
    expect(mapped.txpoolNamespace).toBe('txpool');
    expect(mapped.supportsPeerCount).toBe(true);
    expect(mapped.capabilities).toContain('txpool-monitoring');
    expect(mapped.capabilities).toContain('peer-monitoring');
    expect(mapped.capabilities).toContain('sync-monitoring');
  });

  it('maps nethermind parity_* txpool fallback correctly', () => {
    const detected: DetectedClient = {
      layer: 'execution',
      family: 'nethermind',
      version: 'Nethermind/v1.26.0',
      supportsL2SyncStatus: false,
      l2SyncMethod: null,
      txpoolNamespace: 'parity',
      probes: {
        eth_syncing: true,
        net_peerCount: true,
        txpool_status: false,
        parity_pendingTransactions: true,
      },
    };

    const mapped = mapDetectedClientToCapabilities(detected, 'ethereum-el');
    expect(mapped.supportsTxPool).toBe(true);
    expect(mapped.txpoolNamespace).toBe('parity');
    expect(mapped.capabilities).toContain('txpool-monitoring');
  });

  it('reports txpoolNamespace=null when both txpool probes fail', () => {
    const detected: DetectedClient = {
      layer: 'execution',
      family: 'unknown',
      supportsL2SyncStatus: false,
      l2SyncMethod: null,
      txpoolNamespace: null,
      probes: {
        txpool_status: false,
        parity_pendingTransactions: false,
      },
    };

    const mapped = mapDetectedClientToCapabilities(detected, 'ethereum-el');
    expect(mapped.supportsTxPool).toBe(false);
    expect(mapped.txpoolNamespace).toBeNull();
    expect(mapped.capabilities).not.toContain('txpool-monitoring');
  });

});
