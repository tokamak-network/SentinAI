import { buildAgentMarketplaceReputationBatch } from '@/lib/agent-marketplace/reputation-batch';
import { publishAgentMarketplaceReputationBatch } from '@/lib/agent-marketplace/reputation-publisher';
import {
  getAgentMarketplaceReputationScores,
  setAgentMarketplaceReputationScores,
} from '@/lib/agent-marketplace/reputation-state-store';
import { summarizeAgentMarketplaceSla } from '@/lib/agent-marketplace/sla-tracker';

export type PublishDailyAgentMarketplaceReputationBatchResult =
  | { ok: true; batchHash: string; txHash: `0x${string}` | string }
  | { ok: false; error: string };

export async function publishDailyAgentMarketplaceReputationBatch(input: {
  fromIso: string;
  toIso: string;
  previousScores?: Record<string, number>;
  batchTimestamp: number;
}): Promise<PublishDailyAgentMarketplaceReputationBatchResult> {
  const walletKey = process.env.MARKETPLACE_WALLET_KEY?.trim();
  const registryAddress = process.env.MARKETPLACE_REPUTATION_REGISTRY_ADDRESS?.trim();

  if (!walletKey || !registryAddress) {
    return {
      ok: false,
      error: 'MARKETPLACE_WALLET_KEY and MARKETPLACE_REPUTATION_REGISTRY_ADDRESS are required',
    };
  }

  let previousScores: Record<string, number>;
  if (input.previousScores) {
    previousScores = input.previousScores;
  } else {
    try {
      previousScores = await getAgentMarketplaceReputationScores();
    } catch (error) {
      return {
        ok: false,
        error: `Failed to load agent marketplace reputation scores from Redis: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const slaSummary = await summarizeAgentMarketplaceSla({
    fromIso: input.fromIso,
    toIso: input.toIso,
    previousScores,
  });

  const batch = buildAgentMarketplaceReputationBatch({
    batchTimestamp: input.batchTimestamp,
    agents: slaSummary.agents.map((agent) => ({
      agentId: agent.agentId as `0x${string}`,
      score: agent.newScore,
    })),
  });

  const publishResult = await publishAgentMarketplaceReputationBatch({
    walletKey: walletKey as `0x${string}`,
    registryAddress: registryAddress as `0x${string}`,
    batch,
  });

  if (publishResult.ok) {
    try {
      await setAgentMarketplaceReputationScores(
        Object.fromEntries(
          slaSummary.agents.map((agent) => [agent.agentId, agent.newScore])
        )
      );
    } catch (error) {
      return {
        ok: false,
        error: `Failed to persist agent marketplace reputation scores to Redis: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return publishResult;
}
