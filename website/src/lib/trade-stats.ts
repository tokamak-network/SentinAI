import { createPublicClient, http, parseAbiItem, formatUnits } from 'viem';
import { sepolia } from 'viem/chains';

const REGISTRY_ADDRESS = '0x64c8f8cB66657349190c7AF783f8E0254dCF1467' as const;
const TON_ADDRESS = '0xa30fe40285b8f5c0457dbc3b7c8a280373c40044' as const;
const REVIEW_REGISTRY = '0x3b5F5d476e53c970e8cb2b1b547B491dcBAa5b02' as const;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Deployment blocks — avoid scanning from genesis
const REGISTRY_DEPLOY_BLOCK = BigInt('0x9f4671');  // ERC8004Registry
const REVIEW_REGISTRY_DEPLOY_BLOCK = BigInt('0xa08000');  // ReviewRegistry (approx)
const MAX_BLOCK_RANGE = BigInt(49000);

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

    const latestBlock = await client.getBlockNumber();

    // 1. Get registered agent addresses from ERC8004 Registry (chunked scan)
    const REGISTRY_EVENT = parseAbiItem(
      'event AgentRegistered(uint256 indexed agentId, address indexed agent, string agentURI)'
    );
    const merchantAddresses = new Set<string>();

    for (let from = REGISTRY_DEPLOY_BLOCK; from <= latestBlock; from += MAX_BLOCK_RANGE) {
      const to = from + MAX_BLOCK_RANGE - BigInt(1) > latestBlock ? latestBlock : from + MAX_BLOCK_RANGE - BigInt(1);
      const logs = await client.getLogs({
        address: REGISTRY_ADDRESS,
        event: REGISTRY_EVENT,
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        const agent = (log.args as { agent?: string }).agent;
        if (agent) merchantAddresses.add(agent.toLowerCase());
      }
    }

    // 2. Get trade data from ReviewRegistry TradeRecorded events (more accurate than TON Transfers)
    const TRADE_EVENT = parseAbiItem(
      'event TradeRecorded(address indexed buyer, address indexed operator, uint256 amount, string resource, bytes32 indexed nonce)'
    );

    let totalVolume = BigInt(0);
    const globalBuyers = new Set<string>();
    const perAgent: Record<string, { transactions: number; volume: bigint; buyers: Set<string> }> = {};

    for (let from = REVIEW_REGISTRY_DEPLOY_BLOCK; from <= latestBlock; from += MAX_BLOCK_RANGE) {
      const to = from + MAX_BLOCK_RANGE - BigInt(1) > latestBlock ? latestBlock : from + MAX_BLOCK_RANGE - BigInt(1);
      const logs = await client.getLogs({
        address: REVIEW_REGISTRY,
        event: TRADE_EVENT,
        fromBlock: from,
        toBlock: to,
      });

      for (const log of logs) {
        const args = log.args as { buyer?: string; operator?: string; amount?: bigint };
        const buyer = args.buyer?.toLowerCase();
        const operator = args.operator?.toLowerCase();
        const value = args.amount ?? BigInt(0);

        if (!buyer || !operator) continue;

        totalVolume += value;
        globalBuyers.add(buyer);

        if (!perAgent[operator]) {
          perAgent[operator] = { transactions: 0, volume: BigInt(0), buyers: new Set() };
        }
        perAgent[operator].transactions++;
        perAgent[operator].volume += value;
        perAgent[operator].buyers.add(buyer);
      }
    }

    // Aggregate results
    let totalTransactions = 0;
    const perAgentResult: Record<string, AgentTradeStats> = {};
    for (const [addr, stats] of Object.entries(perAgent)) {
      totalTransactions += stats.transactions;
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
        totalTransactions,
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
