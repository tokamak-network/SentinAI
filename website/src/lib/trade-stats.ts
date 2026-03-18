import { createPublicClient, http, parseAbiItem, formatUnits } from 'viem';
import { sepolia } from 'viem/chains';

const REGISTRY_ADDRESS = '0x64c8f8cB66657349190c7AF783f8E0254dCF1467' as const;
const TON_ADDRESS = '0xa30fe40285b8f5c0457dbc3b7c8a280373c40044' as const;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface AgentTradeStats {
  transactions: number;
  volumeTON: string;
  uniqueBuyers: number;
}

export interface TradeStatsResult {
  ok: boolean;
  global: {
    registeredAgents: number;
    totalTransactions: number;
    totalVolumeTON: string;
    uniqueBuyers: number;
  };
  perAgent: Record<string, AgentTradeStats>;
  cachedAt: string;
}

type TradeStatsCacheState = {
  value: TradeStatsResult | null;
  cachedAt: number | null;
};

const globalForTradeStatsCache = globalThis as typeof globalThis & {
  __sentinaiTradeStatsCache?: TradeStatsCacheState;
};

function getCache(): TradeStatsCacheState {
  if (!globalForTradeStatsCache.__sentinaiTradeStatsCache) {
    globalForTradeStatsCache.__sentinaiTradeStatsCache = { value: null, cachedAt: null };
  }
  return globalForTradeStatsCache.__sentinaiTradeStatsCache;
}

function emptyResult(): TradeStatsResult {
  return {
    ok: false,
    global: { registeredAgents: 0, totalTransactions: 0, totalVolumeTON: '0', uniqueBuyers: 0 },
    perAgent: {},
    cachedAt: new Date().toISOString(),
  };
}

export async function getTradeStats(): Promise<TradeStatsResult> {
  const rpcUrl = process.env.SEPOLIA_RPC_URL?.trim();
  if (!rpcUrl) {
    return emptyResult();
  }

  const cache = getCache();
  const now = Date.now();

  if (cache.value && cache.cachedAt !== null && now - cache.cachedAt < CACHE_TTL_MS) {
    return cache.value;
  }

  try {
    const client = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl, { timeout: 20_000 }),
    });

    // 1. Get registered agent addresses from ERC8004 Registry
    const registryLogs = await client.getLogs({
      address: REGISTRY_ADDRESS,
      event: parseAbiItem(
        'event AgentRegistered(uint256 indexed agentId, address indexed agent, string agentURI)'
      ),
      fromBlock: BigInt(0),
      toBlock: 'latest',
    });

    const merchantAddresses = new Set<string>();
    for (const log of registryLogs) {
      const agent = log.args.agent;
      if (typeof agent === 'string') {
        merchantAddresses.add(agent.toLowerCase());
      }
    }

    // 2. Get TON ERC20 Transfer events
    const transferLogs = await client.getLogs({
      address: TON_ADDRESS,
      event: parseAbiItem(
        'event Transfer(address indexed from, address indexed to, uint256 value)'
      ),
      fromBlock: BigInt(0),
      toBlock: 'latest',
    });

    // 3. Filter and aggregate
    let totalVolume = BigInt(0);
    const globalBuyers = new Set<string>();
    const perAgent: Record<string, { transactions: number; volume: bigint; buyers: Set<string> }> = {};

    for (const log of transferLogs) {
      const to = log.args.to?.toLowerCase();
      const from = log.args.from?.toLowerCase();
      const value = log.args.value ?? BigInt(0);

      if (!to || !from || !merchantAddresses.has(to)) continue;

      totalVolume += value;
      globalBuyers.add(from);

      if (!perAgent[to]) {
        perAgent[to] = { transactions: 0, volume: BigInt(0), buyers: new Set() };
      }
      perAgent[to].transactions++;
      perAgent[to].volume += value;
      perAgent[to].buyers.add(from);
    }

    const perAgentResult: Record<string, AgentTradeStats> = {};
    for (const [addr, stats] of Object.entries(perAgent)) {
      perAgentResult[addr] = {
        transactions: stats.transactions,
        volumeTON: formatUnits(stats.volume, 18),
        uniqueBuyers: stats.buyers.size,
      };
    }

    const result: TradeStatsResult = {
      ok: true,
      global: {
        registeredAgents: merchantAddresses.size,
        totalTransactions: transferLogs.filter(
          (log) => log.args.to && merchantAddresses.has(log.args.to.toLowerCase())
        ).length,
        totalVolumeTON: formatUnits(totalVolume, 18),
        uniqueBuyers: globalBuyers.size,
      },
      perAgent: perAgentResult,
      cachedAt: new Date().toISOString(),
    };

    cache.value = result;
    cache.cachedAt = now;

    return result;
  } catch (error) {
    console.error('[trade-stats] Failed to fetch on-chain data:', error);
    return emptyResult();
  }
}
