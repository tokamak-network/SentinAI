import {
  agentMarketplaceRegistryContract,
  agentMarketplaceRegistryEventNames,
} from '@/lib/agent-marketplace/abi/agent-registry';
import {
  agentMarketplaceReputationRegistryContract,
  agentMarketplaceReputationRegistryEventNames,
} from '@/lib/agent-marketplace/abi/reputation-registry';

export function getAgentMarketplaceContractsStatus() {
  return {
    registry: {
      name: agentMarketplaceRegistryContract.name,
      address: process.env.ERC8004_REGISTRY_ADDRESS?.trim() || null,
      eventNames: [...agentMarketplaceRegistryEventNames],
    },
    reputation: {
      name: agentMarketplaceReputationRegistryContract.name,
      address: process.env.MARKETPLACE_REPUTATION_REGISTRY_ADDRESS?.trim() || null,
      eventNames: [...agentMarketplaceReputationRegistryEventNames],
    },
  };
}
