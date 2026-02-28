import { describe, expect, it } from 'vitest';
import { mapDetectedClientToCapabilities } from '@/lib/capability-mapper';
import type { DetectedClient } from '@/lib/client-detector';

describe('capability-mapper', () => {
  it('maps execution client probes into txpool/peer/sync capabilities', () => {
    const detected: DetectedClient = {
      layer: 'execution',
      family: 'geth',
      version: 'Geth/v1.0.0',
      probes: {
        eth_syncing: true,
        admin_peers: true,
        txpool_status: true,
      },
    };

    const mapped = mapDetectedClientToCapabilities(detected, 'ethereum-el');
    expect(mapped.supportsTxPool).toBe(true);
    expect(mapped.supportsPeerCount).toBe(true);
    expect(mapped.capabilities).toContain('txpool-monitoring');
    expect(mapped.capabilities).toContain('peer-monitoring');
    expect(mapped.capabilities).toContain('sync-monitoring');
  });

  it('adds CL-specific capabilities for ethereum-cl', () => {
    const detected: DetectedClient = {
      layer: 'consensus',
      family: 'lighthouse',
      version: 'Lighthouse/v5.0.0',
      probes: {
        '/eth/v1/node/syncing': true,
        '/eth/v1/node/peer_count': true,
      },
    };

    const mapped = mapDetectedClientToCapabilities(detected, 'ethereum-cl');
    expect(mapped.capabilities).toContain('finality-monitoring');
    expect(mapped.capabilities).toContain('validator-monitoring');
    expect(mapped.supportsValidatorDuty).toBe(true);
  });
});
