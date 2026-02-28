import type { ChainPlugin } from '@/chains/types';

export interface SettlementPayload {
  enabled: boolean;
  layer: string;
  finalityMode: string;
  postingLagSec: number;
  healthy: boolean;
}

interface BuildChainOptionalSectionsInput {
  plugin: ChainPlugin;
  syncLag: number;
  settlementStatus: SettlementPayload | null;
}

export function buildChainOptionalSections({
  plugin,
  syncLag,
  settlementStatus,
}: BuildChainOptionalSectionsInput): Record<string, unknown> {
  return {
    ...(plugin.capabilities.proofMonitoring
      ? {
          proof: {
            enabled: true,
            queueDepth: 0,
            generationLagSec: Math.max(0, syncLag),
            verificationLagSec: Math.max(0, Math.floor(syncLag / 2)),
          },
        }
      : {}),
    ...(settlementStatus
      ? {
          settlement: {
            enabled: settlementStatus.enabled,
            layer: settlementStatus.layer,
            finalityMode: settlementStatus.finalityMode,
            postingLagSec: settlementStatus.postingLagSec,
            healthy: settlementStatus.healthy,
          },
        }
      : {}),
  };
}
