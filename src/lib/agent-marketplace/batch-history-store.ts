import Redis from 'ioredis';

export interface AgentMarketplaceBatchHistoryRecord {
  status: 'success' | 'failed';
  publishedAt: string;
  window: {
    fromIso: string;
    toIso: string;
  };
  batchHash: string | null;
  txHash: string | null;
  merkleRoot: string | null;
  error: string | null;
}

const BATCH_HISTORY_KEY = 'sentinai:agent-marketplace:reputation:batches';
const BATCH_HISTORY_LIMIT = 50;

const globalForAgentMarketplaceBatchHistory = globalThis as unknown as {
  __sentinai_agent_marketplace_batch_history_redis?: Redis;
};

function getRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for agent marketplace batch history');
  }

  return redisUrl;
}

function getRedisClient(): Redis {
  if (globalForAgentMarketplaceBatchHistory.__sentinai_agent_marketplace_batch_history_redis) {
    return globalForAgentMarketplaceBatchHistory.__sentinai_agent_marketplace_batch_history_redis;
  }

  const client = new Redis(getRedisUrl(), {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 3,
  });

  globalForAgentMarketplaceBatchHistory.__sentinai_agent_marketplace_batch_history_redis = client;
  return client;
}

export async function appendAgentMarketplaceBatchHistory(
  record: AgentMarketplaceBatchHistoryRecord
): Promise<void> {
  const client = getRedisClient();
  await client.rpush(BATCH_HISTORY_KEY, JSON.stringify(record));
  await client.ltrim(BATCH_HISTORY_KEY, -BATCH_HISTORY_LIMIT, -1);
}

export async function getAgentMarketplaceBatchHistory(): Promise<AgentMarketplaceBatchHistoryRecord[]> {
  const records = await getRedisClient().lrange(BATCH_HISTORY_KEY, 0, -1);
  return records
    .map((record) => JSON.parse(record) as AgentMarketplaceBatchHistoryRecord)
    .reverse();
}

export async function clearAgentMarketplaceBatchHistory(): Promise<void> {
  try {
    await getRedisClient().del(BATCH_HISTORY_KEY);
  } catch {
    // Ignore cleanup failures in test-only callers.
  }
}
