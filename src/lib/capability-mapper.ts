import type { NodeType, ProtocolCapability } from '@/core/types';
import type { DetectedClient } from './client-detector';

export interface CapabilityMapping {
  capabilities: ProtocolCapability[];
  supportsTxPool: boolean;
  supportsPeerCount: boolean;
  supportsValidatorDuty: boolean;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function mapDetectedClientToCapabilities(
  detected: DetectedClient,
  protocolId: NodeType
): CapabilityMapping {
  const supportsTxPool = detected.layer === 'execution' && !!detected.probes.txpool_status;
  const supportsPeerCount =
    detected.layer === 'execution'
      ? !!detected.probes.net_peerCount || !!detected.probes.admin_peers
      : !!detected.probes['/eth/v1/node/peer_count'];

  // Best-effort: for CL, most modern clients support validator duty endpoints, but
  // it may require indices; do not probe here.
  const supportsValidatorDuty = detected.layer === 'consensus';

  const caps: ProtocolCapability[] = ['block-production'];

  // Syncing
  if (
    (detected.layer === 'execution' && detected.probes.eth_syncing) ||
    (detected.layer === 'consensus' && detected.probes['/eth/v1/node/syncing'])
  ) {
    caps.push('sync-monitoring');
  }

  // Peer monitoring
  if (supportsPeerCount) caps.push('peer-monitoring');

  // Txpool monitoring
  if (supportsTxPool) caps.push('txpool-monitoring');

  // CL-specific
  if (protocolId === 'ethereum-cl') {
    caps.push('finality-monitoring');
    if (supportsValidatorDuty) caps.push('validator-monitoring');
  }

  // L2-specific (safe defaults)
  if (protocolId === 'opstack-l2' || protocolId === 'arbitrum-nitro' || protocolId === 'zkstack') {
    caps.push('l1-dependency-monitoring', 'gas-monitoring');
  }

  return {
    capabilities: uniq(caps),
    supportsTxPool,
    supportsPeerCount,
    supportsValidatorDuty,
  };
}
