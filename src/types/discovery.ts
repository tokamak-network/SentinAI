/**
 * Agent Marketplace Discovery Protocol Types
 * Network-level discovery of registered agents and their services.
 */

export interface DiscoveryNetworkInfo {
  registryContract: string;
  chain: 'sepolia' | 'mainnet';
  chainId: number;
  totalAgents: number;
  discoveredAt: string;
}

export interface DiscoveredService {
  key: string;
  displayName: string;
  description: string;
  state: 'active' | 'planned';
  pricing: {
    amount: string;
    token: string;
    network: string;
    scheme: 'exact';
  } | null;
}

export interface DiscoveredAgent {
  agentId: string;
  address: string;
  agentUri: string;
  name: string;
  version: string;
  endpoint: string;
  status: 'available' | 'unavailable';
  services: DiscoveredService[];
  payment: {
    protocol: 'x402';
    network: string;
  };
  operator: {
    id: string;
    status: string;
  };
}

export interface DiscoveryRootResponse {
  ok: boolean;
  network: DiscoveryNetworkInfo;
  selfAgent: DiscoveredAgent | null;
}

export interface DiscoveryAgentsResponse {
  ok: boolean;
  agents: DiscoveredAgent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  discoveredAt: string;
}

export interface DiscoveryAgentDetailResponse {
  ok: boolean;
  agent: DiscoveredAgent | null;
  error?: string;
}

export interface ServicePricingOffer {
  agentAddress: string;
  agentName: string;
  pricing: DiscoveredService['pricing'];
  endpoint: string;
}

export interface ServicePricingComparison {
  serviceKey: string;
  offers: ServicePricingOffer[];
}

export interface DiscoveryOptions {
  page?: number;
  pageSize?: number;
}
