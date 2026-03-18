/**
 * Agent Marketplace Discovery
 * Aggregates registered agents from ERC8004 registry and enriches with catalog data.
 * Implements BitTorrent-style discovery: any operator's server can return the full network view.
 */

import { getAgentMarketplaceRegistryBrowseData } from '@/lib/agent-marketplace/registry-browse';
import { getAgentMarketplaceCatalog } from '@/lib/agent-marketplace/catalog';
import type { AgentMarketplaceCatalog } from '@/types/agent-marketplace';
import type {
  DiscoveredAgent,
  DiscoveredService,
  DiscoveryNetworkInfo,
  DiscoveryOptions,
  ServicePricingComparison,
} from '@/types/discovery';

const DISCOVERY_CACHE_TTL_MS = 30_000;
const CATALOG_FETCH_TIMEOUT_MS = 5_000;

type DiscoveryCache = {
  agents: DiscoveredAgent[] | null;
  cachedAt: number | null;
};

const globalForDiscoveryCache = globalThis as typeof globalThis & {
  __sentinaiDiscoveryCache?: DiscoveryCache;
};

function getDiscoveryCache(): DiscoveryCache {
  if (!globalForDiscoveryCache.__sentinaiDiscoveryCache) {
    globalForDiscoveryCache.__sentinaiDiscoveryCache = {
      agents: null,
      cachedAt: null,
    };
  }
  return globalForDiscoveryCache.__sentinaiDiscoveryCache;
}

export function resolveSelfAddress(): string | null {
  const walletKey = process.env.MARKETPLACE_WALLET_KEY?.trim();
  if (!walletKey) return null;

  // Derive address from private key using viem if available,
  // otherwise return null to skip self-detection.
  try {
    // Dynamic import to avoid loading viem in environments that don't need it
    // We just do a simple check: private key → public key → address
    const { privateKeyToAddress } = require('viem/accounts') as {
      privateKeyToAddress: (key: `0x${string}`) => string;
    };
    const key = walletKey.startsWith('0x') ? walletKey : `0x${walletKey}`;
    return privateKeyToAddress(key as `0x${string}`).toLowerCase();
  } catch {
    return null;
  }
}

function resolveRegistryChainInfo(): { chain: 'sepolia' | 'mainnet'; chainId: number } {
  const network = process.env.X402_NETWORK?.trim();
  if (network === 'eip155:1') {
    return { chain: 'mainnet', chainId: 1 };
  }
  return { chain: 'sepolia', chainId: 11155111 };
}

function catalogToDiscoveredServices(catalog: AgentMarketplaceCatalog): DiscoveredService[] {
  return catalog.services.map((svc) => ({
    key: svc.key,
    displayName: svc.displayName,
    description: svc.description,
    state: svc.state,
    pricing: svc.payment
      ? {
          amount: svc.payment.amount,
          token: svc.payment.token,
          network: svc.payment.network,
          scheme: svc.payment.scheme,
        }
      : null,
  }));
}

async function fetchRemoteCatalog(endpoint: string): Promise<AgentMarketplaceCatalog | null> {
  try {
    const url = `${endpoint.replace(/\/$/, '')}/api/agent-marketplace/catalog`;
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      agent?: AgentMarketplaceCatalog['agent'];
      services?: AgentMarketplaceCatalog['services'];
      updatedAt?: string;
      acceptableUsePolicyVersion?: string;
    };

    if (!data.agent || !Array.isArray(data.services)) return null;

    return {
      agent: data.agent,
      services: data.services,
      updatedAt: data.updatedAt ?? new Date().toISOString(),
      acceptableUsePolicyVersion: data.acceptableUsePolicyVersion ?? '',
    };
  } catch {
    return null;
  }
}

async function enrichAgent(
  agentId: string,
  address: string,
  agentUri: string,
  manifestName: string,
  manifestVersion: string,
  manifestEndpoint: string,
  manifestPaymentNetwork: string,
  selfAddress: string | null
): Promise<DiscoveredAgent> {
  // Self-detection: avoid HTTP self-call by using local catalog directly
  const isSelf = selfAddress !== null && address.toLowerCase() === selfAddress;

  let catalog: AgentMarketplaceCatalog | null = null;

  if (isSelf) {
    catalog = getAgentMarketplaceCatalog();
  } else if (manifestEndpoint) {
    catalog = await fetchRemoteCatalog(manifestEndpoint);
  }

  const services = catalog ? catalogToDiscoveredServices(catalog) : [];
  const operatorId = catalog?.agent?.operator ?? 'unknown';
  const operatorStatus = catalog?.agent?.status ?? 'unknown';

  return {
    agentId,
    address,
    agentUri,
    name: catalog?.agent ? `${manifestName}` : manifestName,
    version: catalog?.agent?.version ?? manifestVersion,
    endpoint: manifestEndpoint,
    status: catalog ? 'available' : 'unavailable',
    services,
    payment: {
      protocol: 'x402',
      network: manifestPaymentNetwork,
    },
    operator: {
      id: operatorId,
      status: operatorStatus,
    },
  };
}

async function loadAllDiscoveredAgents(): Promise<DiscoveredAgent[]> {
  const cache = getDiscoveryCache();
  const now = Date.now();

  if (
    cache.agents !== null &&
    cache.cachedAt !== null &&
    now - cache.cachedAt < DISCOVERY_CACHE_TTL_MS
  ) {
    return cache.agents;
  }

  const selfAddress = resolveSelfAddress();

  // Load all pages from registry browse (page 1 gets all via internal full data)
  // We bypass pagination by loading with a large page—but registry-browse uses
  // the cached full data. We'll fetch page 1 repeatedly or use the full rows.
  // Since registry-browse paginates at 5, we need all rows.
  // Approach: fetch page 1 and then subsequent pages until done.
  const allRows: Array<{
    agentId: string;
    agent: string;
    agentUri: string;
    manifest: {
      name: string;
      version: string;
      endpoint: string;
      capabilities: string[];
      paymentNetwork: string;
    } | null;
  }> = [];

  let page = 1;
  while (true) {
    const data = await getAgentMarketplaceRegistryBrowseData({ page });
    allRows.push(...data.rows);
    if (!data.hasNextPage) break;
    page++;
  }

  const agents = await Promise.all(
    allRows.map((row) => {
      const manifest = row.manifest;
      return enrichAgent(
        row.agentId,
        row.agent,
        row.agentUri,
        manifest?.name ?? 'Unknown Agent',
        manifest?.version ?? '0.0.0',
        manifest?.endpoint ?? '',
        manifest?.paymentNetwork ?? 'eip155:11155111',
        selfAddress
      );
    })
  );

  cache.agents = agents;
  cache.cachedAt = now;

  return agents;
}

export async function getDiscoveryNetworkInfo(): Promise<DiscoveryNetworkInfo> {
  const registryAddress = process.env.ERC8004_REGISTRY_ADDRESS?.trim() ?? '';
  const chainInfo = resolveRegistryChainInfo();

  let totalAgents = 0;
  if (registryAddress) {
    const data = await getAgentMarketplaceRegistryBrowseData({ page: 1 });
    totalAgents = data.totalRows;
  }

  return {
    registryContract: registryAddress || '0x0000000000000000000000000000000000000000',
    chain: chainInfo.chain,
    chainId: chainInfo.chainId,
    totalAgents,
    discoveredAt: new Date().toISOString(),
  };
}

export async function getDiscoveredAgents(options?: DiscoveryOptions): Promise<{
  agents: DiscoveredAgent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  discoveredAt: string;
}> {
  const allAgents = await loadAllDiscoveredAgents();
  const total = allAgents.length;

  const rawPage = typeof options?.page === 'number' && options.page >= 1 ? Math.floor(options.page) : 1;
  const rawPageSize = typeof options?.pageSize === 'number' ? Math.min(Math.max(options.pageSize, 1), 50) : 10;

  const totalPages = Math.max(1, Math.ceil(total / rawPageSize));
  const page = Math.min(rawPage, totalPages);
  const startIndex = (page - 1) * rawPageSize;
  const agents = allAgents.slice(startIndex, startIndex + rawPageSize);

  return {
    agents,
    total,
    page,
    pageSize: rawPageSize,
    totalPages,
    discoveredAt: new Date().toISOString(),
  };
}

export async function getDiscoveredAgentByAddress(address: string): Promise<DiscoveredAgent | null> {
  const allAgents = await loadAllDiscoveredAgents();
  return allAgents.find((a) => a.address.toLowerCase() === address.toLowerCase()) ?? null;
}

export async function getServicePricingComparison(serviceKey: string): Promise<ServicePricingComparison> {
  const allAgents = await loadAllDiscoveredAgents();

  const offers = allAgents
    .filter((agent) => agent.status === 'available')
    .flatMap((agent) => {
      const service = agent.services.find((svc) => svc.key === serviceKey);
      if (!service) return [];
      return [{
        agentAddress: agent.address,
        agentName: agent.name,
        pricing: service.pricing,
        endpoint: agent.endpoint,
      }];
    });

  return {
    serviceKey,
    offers,
  };
}
