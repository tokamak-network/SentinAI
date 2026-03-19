import Redis from 'ioredis';
import type { AgentMarketplaceServiceKey } from '@/types/agent-marketplace';
import { operatorKey } from '@/lib/agent-marketplace/operator-key';

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
  operatorAddress?: string;
}

const BASE_REQUEST_LOGS_KEY = 'sentinai:agent-marketplace:request-logs';

function getRequestLogsKey(operatorAddress?: string): string {
  return `${BASE_REQUEST_LOGS_KEY}${operatorKey(operatorAddress)}`;
}

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

async function listRequestLogs(operatorAddress?: string): Promise<AgentMarketplaceRequestLogRecord[]> {
  const client = getRedisClient();
  if (!client) {
    return [];
  }

  const records = await client.lrange(getRequestLogsKey(operatorAddress), 0, -1);
  return records.map((record) => JSON.parse(record) as AgentMarketplaceRequestLogRecord);
}

export async function recordAgentMarketplaceRequest(
  record: AgentMarketplaceRequestLogRecord
): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    return;
  }

  await client.rpush(getRequestLogsKey(record.operatorAddress), JSON.stringify(record));
}

export async function getAgentMarketplaceRequestLogs(
  operatorAddress?: string
): Promise<AgentMarketplaceRequestLogRecord[]> {
  return listRequestLogs(operatorAddress);
}

export async function getAgentMarketplaceRequestLogsByWindow(input: {
  fromIso: string;
  toIso: string;
  operatorAddress?: string;
}): Promise<AgentMarketplaceRequestLogRecord[]> {
  const from = new Date(input.fromIso).getTime();
  const to = new Date(input.toIso).getTime();
  const logs = await listRequestLogs(input.operatorAddress);

  return logs.filter((record) => {
    const timestamp = new Date(record.timestamp).getTime();
    return timestamp >= from && timestamp <= to;
  });
}

export async function clearAgentMarketplaceRequestLogs(operatorAddress?: string): Promise<void> {
  try {
    const client = getRedisClient();
    if (!client) {
      return;
    }
    await client.del(getRequestLogsKey(operatorAddress));
  } catch {
    // Ignore cleanup failures in test-only callers.
  }
}
