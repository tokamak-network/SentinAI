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
  opsSnapshot: {
    endpoint: string;
    description: string;
  };
  discovery: {
    catalogEndpoint: string;
    discoveryEndpoint: string;
  };
  dataCatalog: Array<{
    key: string;
    displayName: string;
    description: string;
    pricing: {
      amount: string;
      token: string;
      network: string;
    } | null;
  }>;
  operator: {
    id: string;
    status: string;
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
    opsSnapshot: {
      endpoint: '/api/agent-marketplace/ops-snapshot.json',
      description: 'Live operational data: metrics, scaling state, and anomaly summary',
    },
    discovery: {
      catalogEndpoint: '/api/agent-marketplace/catalog',
      discoveryEndpoint: '/api/discovery',
    },
    dataCatalog: catalog.services.map((service) => ({
      key: service.key,
      displayName: service.displayName,
      description: service.description,
      pricing: service.payment
        ? {
            amount: service.payment.amount,
            token: service.payment.token,
            network: service.payment.network,
          }
        : null,
    })),
    operator: {
      id: catalog.agent.operator,
      status: catalog.agent.status,
    },
  };
}
