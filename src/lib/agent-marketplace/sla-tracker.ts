import { getAgentMarketplaceRequestLogsByWindow } from '@/lib/agent-marketplace/request-log-store';

interface AgentMarketplaceSlaSummaryInput {
  fromIso: string;
  toIso: string;
  previousScores: Record<string, number>;
}

interface AgentMarketplaceSlaAgentSummary {
  agentId: string;
  totalRequests: number;
  successRate: number;
  averageLatencyMs: number | null;
  scoreDelta: number;
  newScore: number;
}

export interface AgentMarketplaceSlaSummary {
  fromIso: string;
  toIso: string;
  agents: AgentMarketplaceSlaAgentSummary[];
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

export async function summarizeAgentMarketplaceSla(
  input: AgentMarketplaceSlaSummaryInput
): Promise<AgentMarketplaceSlaSummary> {
  const logs = await getAgentMarketplaceRequestLogsByWindow({
    fromIso: input.fromIso,
    toIso: input.toIso,
  });

  const byAgent = new Map<string, typeof logs>();
  for (const log of logs) {
    const agentLogs = byAgent.get(log.agentId) ?? [];
    agentLogs.push(log);
    byAgent.set(log.agentId, agentLogs);
  }

  const agents = Array.from(byAgent.entries()).map(([agentId, agentLogs]) => {
    const successes = agentLogs.filter((log) => log.success);
    const successRate = Number(((successes.length / agentLogs.length) * 100).toFixed(2));
    const averageLatencyMs = successes.length > 0
      ? Math.round(successes.reduce((sum, log) => sum + log.latencyMs, 0) / successes.length)
      : null;

    let scoreDelta = 0;
    if (successRate < 95) {
      scoreDelta -= 5;
    }
    if (averageLatencyMs === null) {
      scoreDelta -= 5;
    } else if (averageLatencyMs > 2000) {
      scoreDelta -= 5;
    }
    if (successRate === 100 && averageLatencyMs !== null && averageLatencyMs <= 2000) {
      scoreDelta += 2;
    }

    const previousScore = input.previousScores[agentId] ?? 100;
    return {
      agentId,
      totalRequests: agentLogs.length,
      successRate,
      averageLatencyMs,
      scoreDelta,
      newScore: clampScore(previousScore + scoreDelta),
    };
  });

  agents.sort((left, right) => left.agentId.localeCompare(right.agentId));

  return {
    fromIso: input.fromIso,
    toIso: input.toIso,
    agents,
  };
}
