import Redis from 'ioredis';
import type { AgentMarketplaceServiceKey } from '@/types/agent-marketplace';

export type AgentMarketplaceVerificationResult =
  | 'verified'
  | 'rejected'
  | 'rate_limited';

export interface AgentMarketplaceRequestLogRecord {
  agentId: string;
  serviceKey: AgentMarketplaceServiceKey;
  timestamp: string;
  latencyMs: number;
  verificationResult: AgentMarketplaceVerificationResult;
  success: boolean;
}

const REQUEST_LOGS_KEY = 'sentinai:agent-marketplace:request-logs';

const globalForAgentMarketplaceRequestLog = globalThis as unknown as {
  __sentinai_agent_marketplace_request_log_redis?: Redis;
};

function getRedisUrl(): string | null {
  return process.env.REDIS_URL?.trim() ?? null;
}

function getRedisClient(): Redis | null {
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    return null;
  }

  if (globalForAgentMarketplaceRequestLog.__sentinai_agent_marketplace_request_log_redis) {
    return globalForAgentMarketplaceRequestLog.__sentinai_agent_marketplace_request_log_redis;
  }

  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 3,
  });

  globalForAgentMarketplaceRequestLog.__sentinai_agent_marketplace_request_log_redis = client;
  return client;
}

async function listRequestLogs(): Promise<AgentMarketplaceRequestLogRecord[]> {
  const client = getRedisClient();
  if (!client) {
    return [];
  }

  const records = await client.lrange(REQUEST_LOGS_KEY, 0, -1);
  return records.map((record) => JSON.parse(record) as AgentMarketplaceRequestLogRecord);
}

export async function recordAgentMarketplaceRequest(
  record: AgentMarketplaceRequestLogRecord
): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    return;
  }

  await client.rpush(REQUEST_LOGS_KEY, JSON.stringify(record));
}

export async function getAgentMarketplaceRequestLogs(): Promise<AgentMarketplaceRequestLogRecord[]> {
  return listRequestLogs();
}

export async function getAgentMarketplaceRequestLogsByWindow(input: {
  fromIso: string;
  toIso: string;
}): Promise<AgentMarketplaceRequestLogRecord[]> {
  const from = new Date(input.fromIso).getTime();
  const to = new Date(input.toIso).getTime();
  const logs = await listRequestLogs();

  return logs.filter((record) => {
    const timestamp = new Date(record.timestamp).getTime();
    return timestamp >= from && timestamp <= to;
  });
}

export async function clearAgentMarketplaceRequestLogs(): Promise<void> {
  try {
    const client = getRedisClient();
    if (!client) {
      return;
    }
    await client.del(REQUEST_LOGS_KEY);
  } catch {
    // Ignore cleanup failures in test-only callers.
  }
}
