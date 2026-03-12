import Redis from 'ioredis';

const REPUTATION_SCORES_KEY = 'sentinai:agent-marketplace:reputation:scores';

const globalForAgentMarketplaceReputation = globalThis as unknown as {
  __sentinai_agent_marketplace_reputation_redis?: Redis;
};

function getRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for agent marketplace reputation state');
  }

  return redisUrl;
}

function getRedisClient(): Redis {
  if (globalForAgentMarketplaceReputation.__sentinai_agent_marketplace_reputation_redis) {
    return globalForAgentMarketplaceReputation.__sentinai_agent_marketplace_reputation_redis;
  }

  const client = new Redis(getRedisUrl(), {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 3,
  });

  globalForAgentMarketplaceReputation.__sentinai_agent_marketplace_reputation_redis = client;
  return client;
}

export async function getAgentMarketplaceReputationScores(): Promise<Record<string, number>> {
  const raw = await getRedisClient().get(REPUTATION_SCORES_KEY);
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;

  return Object.fromEntries(
    Object.entries(parsed).map(([agentId, score]) => [agentId, Number(score)])
  );
}

export async function setAgentMarketplaceReputationScores(
  scores: Record<string, number>
): Promise<void> {
  await getRedisClient().set(REPUTATION_SCORES_KEY, JSON.stringify(scores));
}

export async function clearAgentMarketplaceReputationState(): Promise<void> {
  try {
    await getRedisClient().del(REPUTATION_SCORES_KEY);
  } catch {
    // Ignore cleanup failures in test-only callers.
  }
}
