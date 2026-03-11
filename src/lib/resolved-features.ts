import type { ChainCapabilities } from '@/chains/types';
import type { CapabilityMapping } from '@/lib/capability-mapper';
import type { ClientProfile } from '@/lib/client-profile/types';

export interface ResolvedFeatures {
  /** txpool monitoring available (stack supports it AND runtime detected it) */
  txpoolMonitoring: boolean;
  /** peer monitoring available (runtime detected) */
  peerMonitoring: boolean;
  /** L2 sync status available (profile supports it) */
  l2SyncMonitoring: boolean;
  /** number of custom metrics configured (0 = none active) */
  customMetricsCount: number;
  /** client was not detected — running in basic monitoring mode */
  partialSupport: boolean;
}

export function resolveFeatures(
  _chainCapabilities: ChainCapabilities,
  detected: CapabilityMapping,
  profile: ClientProfile,
): ResolvedFeatures {
  return {
    txpoolMonitoring: detected.supportsTxPool && profile.capabilities.supportsTxPool,
    peerMonitoring: detected.supportsPeerCount,
    l2SyncMonitoring: profile.capabilities.supportsL2SyncStatus,
    customMetricsCount: profile.customMetrics.length,
    partialSupport: profile.clientFamily === 'unknown',
  };
}
