import {
  createPublicClient,
  http,
} from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { agentMarketplaceRegistryAbi } from '@/lib/agent-marketplace/abi/agent-registry';

const REGISTRY_BROWSE_CACHE_TTL_MS = 30_000;

interface AgentMarketplaceRegistryBrowseFullData {
  ok: boolean;
  status: string;
  rows: AgentMarketplaceRegistryBrowseRow[];
}

type RegistryBrowseCacheState = {
  value: AgentMarketplaceRegistryBrowseFullData | null;
  cachedAt: number | null;
};

const globalForRegistryBrowseCache = globalThis as typeof globalThis & {
  __sentinaiRegistryBrowseCache?: RegistryBrowseCacheState;
};

type RegistryManifest = {
  name?: string;
  version?: string;
  endpoint?: string;
  capabilities?: string[];
  payment?: {
    network?: string;
  };
};

export interface AgentMarketplaceRegistryBrowseRow {
  agentId: string;
  agent: string;
  agentUri: string;
  manifestStatus: 'ok' | 'unavailable';
  manifest: null | {
    name: string;
    version: string;
    endpoint: string;
    capabilities: string[];
    paymentNetwork: string;
  };
}

export interface AgentMarketplaceRegistryBrowseData {
  ok: boolean;
  status: string;
  rows: AgentMarketplaceRegistryBrowseRow[];
  totalRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface AgentMarketplaceRegistryBrowseOptions {
  page?: number;
}

function getRegistryBrowseCache(): RegistryBrowseCacheState {
  if (!globalForRegistryBrowseCache.__sentinaiRegistryBrowseCache) {
    globalForRegistryBrowseCache.__sentinaiRegistryBrowseCache = {
      value: null,
      cachedAt: null,
    };
  }

  return globalForRegistryBrowseCache.__sentinaiRegistryBrowseCache;
}

export function resetAgentMarketplaceRegistryBrowseCache() {
  globalForRegistryBrowseCache.__sentinaiRegistryBrowseCache = undefined;
}

function normalizePage(page: number | undefined): number {
  if (typeof page !== 'number' || !Number.isFinite(page) || page < 1) {
    return 1;
  }

  return Math.floor(page);
}

function paginateBrowseData(
  data: AgentMarketplaceRegistryBrowseFullData,
  pageInput: number | undefined
): AgentMarketplaceRegistryBrowseData {
  const pageSize = 5;
  const totalRows = data.rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(normalizePage(pageInput), totalPages);
  const startIndex = (page - 1) * pageSize;

  return {
    ok: data.ok,
    status: data.status,
    rows: data.rows.slice(startIndex, startIndex + pageSize),
    totalRows,
    page,
    pageSize,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
}

function resolveL1RpcUrl(): string | undefined {
  return process.env.SENTINAI_L1_RPC_URL?.trim()
    || process.env.L1_RPC_URL?.trim()
    || undefined;
}

function resolveRegistryChain() {
  return process.env.X402_NETWORK?.trim() === 'eip155:1' ? mainnet : sepolia;
}

function normalizeManifest(manifest: RegistryManifest) {
  if (
    typeof manifest.name !== 'string'
    || typeof manifest.version !== 'string'
    || typeof manifest.endpoint !== 'string'
    || !Array.isArray(manifest.capabilities)
  ) {
    return null;
  }

  return {
    name: manifest.name,
    version: manifest.version,
    endpoint: manifest.endpoint,
    capabilities: manifest.capabilities.filter(
      (capability): capability is string => typeof capability === 'string'
    ),
    paymentNetwork: typeof manifest.payment?.network === 'string'
      ? manifest.payment.network
      : 'unknown',
  };
}

async function loadManifest(agentUri: string): Promise<AgentMarketplaceRegistryBrowseRow['manifest']> {
  try {
    const response = await fetch(agentUri, {
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }

    const manifest = normalizeManifest(await response.json() as RegistryManifest);
    return manifest;
  } catch {
    return null;
  }
}

export async function getAgentMarketplaceRegistryBrowseData(
  options?: AgentMarketplaceRegistryBrowseOptions
): Promise<AgentMarketplaceRegistryBrowseData> {
  const registryAddress = process.env.ERC8004_REGISTRY_ADDRESS?.trim();
  const l1RpcUrl = resolveL1RpcUrl();
  const cache = getRegistryBrowseCache();
  const now = Date.now();

  if (!registryAddress || !l1RpcUrl) {
    return paginateBrowseData({
      ok: false,
      status: 'Registry browse is not configured',
      rows: [],
    }, options?.page);
  }

  if (cache.value && cache.cachedAt !== null && now - cache.cachedAt < REGISTRY_BROWSE_CACHE_TTL_MS) {
    return paginateBrowseData(cache.value, options?.page);
  }

  try {
    const client = createPublicClient({
      chain: resolveRegistryChain(),
      transport: http(l1RpcUrl, { timeout: 15_000 }),
    });

    const logs = await client.getLogs({
      address: registryAddress as `0x${string}`,
      event: agentMarketplaceRegistryAbi[1],
      fromBlock: BigInt(0),
      toBlock: 'latest',
    });

    const latestByAgent = new Map<string, {
      agentId: bigint;
      agent: string;
      agentUri: string;
    }>();

    for (const log of logs) {
      const agentId = log.args.agentId;
      const agent = log.args.agent;
      const agentUri = log.args.agentURI;

      if (typeof agent !== 'string' || typeof agentUri !== 'string' || agentId === undefined) {
        continue;
      }

      const current = latestByAgent.get(agent.toLowerCase());
      if (!current || agentId > current.agentId) {
        latestByAgent.set(agent.toLowerCase(), {
          agentId,
          agent,
          agentUri,
        });
      }
    }

    const rows = await Promise.all(
      Array.from(latestByAgent.values())
        .sort((left, right) => Number(right.agentId - left.agentId))
        .map(async (entry) => {
          const manifest = await loadManifest(entry.agentUri);

          return {
            agentId: String(entry.agentId),
            agent: entry.agent,
            agentUri: entry.agentUri,
            manifestStatus: manifest ? 'ok' : 'unavailable',
            manifest,
          } satisfies AgentMarketplaceRegistryBrowseRow;
        })
    );

    const result = {
      ok: true,
      status: rows.length > 0
        ? `Loaded ${rows.length} registry entr${rows.length === 1 ? 'y' : 'ies'}`
        : 'No registry entries discovered yet',
      rows,
    } satisfies AgentMarketplaceRegistryBrowseFullData;

    cache.value = result;
    cache.cachedAt = now;

    return paginateBrowseData(result, options?.page);
  } catch (error) {
    return paginateBrowseData({
      ok: false,
      status: error instanceof Error ? error.message : 'Registry browse failed',
      rows: [],
    }, options?.page);
  }
}
