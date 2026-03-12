import type { AgentMarketplaceCatalog } from '@/types/agent-marketplace';

export interface PublicAgentMarketplaceCatalogResponse {
  agent: AgentMarketplaceCatalog['agent'];
  services: AgentMarketplaceCatalog['services'];
  updatedAt: string;
  acceptableUsePolicyVersion: string;
}

export function toPublicAgentMarketplaceCatalogResponse(
  catalog: AgentMarketplaceCatalog
): PublicAgentMarketplaceCatalogResponse {
  return {
    agent: catalog.agent,
    services: catalog.services,
    updatedAt: catalog.updatedAt,
    acceptableUsePolicyVersion: catalog.acceptableUsePolicyVersion,
  };
}

export interface AgentMarketplaceAgentManifest {
  name: string;
  version: string;
  endpoint: string;
  capabilities: string[];
  payment: {
    protocol: 'x402';
    network: string;
  };
}

export function toAgentMarketplaceAgentManifest(
  catalog: AgentMarketplaceCatalog
): AgentMarketplaceAgentManifest {
  return {
    name: 'SentinAI Agent Marketplace',
    version: catalog.agent.version,
    endpoint: '/api/agent-marketplace',
    capabilities: catalog.services
      .filter((service) => service.state === 'active')
      .map((service) => service.key),
    payment: {
      protocol: 'x402',
      network: catalog.services[0]?.payment?.network ?? 'eip155:1',
    },
  };
}
