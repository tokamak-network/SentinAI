import { getAgentMarketplaceCatalog } from '@/lib/agent-marketplace/catalog';
import { getAgentMarketplaceBatchHistory } from '@/lib/agent-marketplace/batch-history-store';
import { getAgentMarketplaceRequestLogsByWindow } from '@/lib/agent-marketplace/request-log-store';
import { summarizeAgentMarketplaceSla } from '@/lib/agent-marketplace/sla-tracker';

export interface AgentMarketplaceOpsSummary {
  enabled: boolean;
  window: {
    fromIso: string;
    toIso: string;
  };
  requestTotals: {
    total: number;
    verified: number;
    rejected: number;
    rateLimited: number;
  };
  distinctBuyerCount: number;
  services: Array<{
    key: string;
    displayName: string;
    priceAmount: string | null;
    requestCount: number;
  }>;
  topBuyers: Array<{
    agentId: string;
    requestCount: number;
    verifiedCount: number;
  }>;
  recentRequests: Array<{
    agentId: string;
    serviceKey: string;
    serviceDisplayName: string;
    verificationResult: 'verified' | 'rejected' | 'rate_limited';
    success: boolean;
    latencyMs: number;
    timestamp: string;
  }>;
  slaAgents: Awaited<ReturnType<typeof summarizeAgentMarketplaceSla>>['agents'];
  lastBatch: {
    status: 'never' | 'success' | 'failed';
    publishedAt: string | null;
    batchHash: string | null;
    txHash: string | null;
    merkleRoot: string | null;
    error: string | null;
  };
  batchHistory: Array<{
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
  }>;
}

export async function buildAgentMarketplaceOpsSummary(input: {
  fromIso: string;
  toIso: string;
}): Promise<AgentMarketplaceOpsSummary> {
  if (process.env.MARKETPLACE_ENABLED !== 'true') {
    return {
      enabled: false,
      window: input,
      requestTotals: {
        total: 0,
        verified: 0,
        rejected: 0,
        rateLimited: 0,
      },
      distinctBuyerCount: 0,
      services: [],
      topBuyers: [],
      recentRequests: [],
      slaAgents: [],
      lastBatch: {
        status: 'never',
        publishedAt: null,
        batchHash: null,
        txHash: null,
        merkleRoot: null,
        error: null,
      },
      batchHistory: [],
    };
  }

  const catalog = getAgentMarketplaceCatalog();
  const logs = await getAgentMarketplaceRequestLogsByWindow(input);
  const batchHistory = await getAgentMarketplaceBatchHistory();
  const serviceNames = new Map(catalog.services.map((service) => [service.key, service.displayName]));

  const verified = logs.filter((log) => log.verificationResult === 'verified');
  const rejected = logs.filter((log) => log.verificationResult === 'rejected');
  const rateLimited = logs.filter((log) => log.verificationResult === 'rate_limited');

  const topBuyers = Array.from(
    logs.reduce((acc, log) => {
      const current = acc.get(log.agentId) ?? {
        agentId: log.agentId,
        requestCount: 0,
        verifiedCount: 0,
      };
      current.requestCount += 1;
      if (log.verificationResult === 'verified') {
        current.verifiedCount += 1;
      }
      acc.set(log.agentId, current);
      return acc;
    }, new Map<string, { agentId: string; requestCount: number; verifiedCount: number }>())
      .values()
  ).sort((left, right) => {
    if (right.verifiedCount !== left.verifiedCount) {
      return right.verifiedCount - left.verifiedCount;
    }
    if (right.requestCount !== left.requestCount) {
      return right.requestCount - left.requestCount;
    }
    return left.agentId.localeCompare(right.agentId);
  });

  const recentRequests = [...verified]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 10)
    .map((log) => ({
      agentId: log.agentId,
      serviceKey: log.serviceKey,
      serviceDisplayName: serviceNames.get(log.serviceKey) ?? log.serviceKey,
      verificationResult: log.verificationResult,
      success: log.success,
      latencyMs: log.latencyMs,
      timestamp: log.timestamp,
    }));

  const slaSummary = await summarizeAgentMarketplaceSla({
    fromIso: input.fromIso,
    toIso: input.toIso,
    previousScores: {},
  });

  const latestBatch = batchHistory[0];

  return {
    enabled: true,
    window: input,
    requestTotals: {
      total: logs.length,
      verified: verified.length,
      rejected: rejected.length,
      rateLimited: rateLimited.length,
    },
    distinctBuyerCount: new Set(logs.map((log) => log.agentId)).size,
    services: catalog.services.map((service) => ({
      key: service.key,
      displayName: service.displayName,
      priceAmount: service.payment?.amount ?? null,
      requestCount: logs.filter((log) => log.serviceKey === service.key).length,
    })),
    topBuyers,
    recentRequests,
    slaAgents: slaSummary.agents,
    lastBatch: latestBatch
      ? {
          status: latestBatch.status,
          publishedAt: latestBatch.publishedAt,
          batchHash: latestBatch.batchHash,
          txHash: latestBatch.txHash,
          merkleRoot: latestBatch.merkleRoot,
          error: latestBatch.error,
        }
      : {
          status: 'never',
          publishedAt: null,
          batchHash: null,
          txHash: null,
          merkleRoot: null,
          error: null,
        },
    batchHistory,
  };
}
