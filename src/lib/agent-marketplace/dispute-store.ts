import Redis from 'ioredis';

export type AgentMarketplaceDisputeStatus = 'open' | 'reviewed' | 'resolved' | 'rejected';

export interface AgentMarketplaceDisputeRecord {
  id: string;
  agentId: string;
  batchHash: string;
  merkleRoot: string;
  requestedScore: number;
  expectedScore: number;
  reason: string;
  status: AgentMarketplaceDisputeStatus;
  createdAt: string;
  updatedAt: string;
}

const DISPUTES_KEY = 'sentinai:agent-marketplace:disputes';

const globalForAgentMarketplaceDisputes = globalThis as unknown as {
  __sentinai_agent_marketplace_dispute_redis?: Redis;
};

function getRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for agent marketplace disputes');
  }

  return redisUrl;
}

function getRedisClient(): Redis {
  if (globalForAgentMarketplaceDisputes.__sentinai_agent_marketplace_dispute_redis) {
    return globalForAgentMarketplaceDisputes.__sentinai_agent_marketplace_dispute_redis;
  }

  const client = new Redis(getRedisUrl(), {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 3,
  });

  globalForAgentMarketplaceDisputes.__sentinai_agent_marketplace_dispute_redis = client;
  return client;
}

async function readDisputes(): Promise<AgentMarketplaceDisputeRecord[]> {
  const raw = await getRedisClient().get(DISPUTES_KEY);
  return raw ? (JSON.parse(raw) as AgentMarketplaceDisputeRecord[]) : [];
}

async function writeDisputes(disputes: AgentMarketplaceDisputeRecord[]): Promise<void> {
  await getRedisClient().set(DISPUTES_KEY, JSON.stringify(disputes));
}

function assertValidTransition(
  fromStatus: AgentMarketplaceDisputeStatus,
  toStatus: AgentMarketplaceDisputeStatus
): void {
  const allowed: Record<AgentMarketplaceDisputeStatus, AgentMarketplaceDisputeStatus[]> = {
    open: ['reviewed', 'resolved', 'rejected'],
    reviewed: ['resolved', 'rejected'],
    resolved: [],
    rejected: [],
  };

  if (!allowed[fromStatus].includes(toStatus)) {
    throw new Error('Invalid dispute status transition');
  }
}

export async function listAgentMarketplaceDisputes(): Promise<AgentMarketplaceDisputeRecord[]> {
  const disputes = await readDisputes();
  return [...disputes].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createAgentMarketplaceDispute(input: {
  agentId: string;
  batchHash: string;
  merkleRoot: string;
  requestedScore: number;
  expectedScore: number;
  reason: string;
}): Promise<AgentMarketplaceDisputeRecord> {
  const now = new Date().toISOString();
  const dispute: AgentMarketplaceDisputeRecord = {
    id: `disp_${Date.now().toString(36)}`,
    agentId: input.agentId,
    batchHash: input.batchHash,
    merkleRoot: input.merkleRoot,
    requestedScore: input.requestedScore,
    expectedScore: input.expectedScore,
    reason: input.reason,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };

  const disputes = await readDisputes();
  disputes.push(dispute);
  await writeDisputes(disputes);
  return dispute;
}

export async function updateAgentMarketplaceDisputeStatus(
  id: string,
  status: AgentMarketplaceDisputeStatus
): Promise<AgentMarketplaceDisputeRecord> {
  const disputes = await readDisputes();
  const dispute = disputes.find((entry) => entry.id === id);

  if (!dispute) {
    throw new Error(`Dispute not found: ${id}`);
  }

  assertValidTransition(dispute.status, status);
  dispute.status = status;
  dispute.updatedAt = new Date().toISOString();
  await writeDisputes(disputes);
  return dispute;
}
