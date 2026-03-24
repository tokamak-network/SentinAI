/**
 * SLA Metrics — aggregate SLA compliance from sla-tracker
 */

import { summarizeAgentMarketplaceSla } from '@/lib/agent-marketplace/sla-tracker';

export interface SlaMetricsSnapshot {
  avgUptime: string;
  avgResponseTime: string;
  operatorsAboveSLA: number;
  totalOperators: number;
  generatedAt: string;
}

export async function composeSlaMetricsSnapshot(): Promise<SlaMetricsSnapshot> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    const summary = await summarizeAgentMarketplaceSla({
      fromIso: oneDayAgo.toISOString(),
      toIso: now.toISOString(),
      previousScores: {},
    });

    const agents = summary.agents;
    const total = agents.length;

    if (total === 0) {
      return {
        avgUptime: '---',
        avgResponseTime: '---',
        operatorsAboveSLA: 0,
        totalOperators: 0,
        generatedAt: now.toISOString(),
      };
    }

    const avgSuccess = agents.reduce((s, a) => s + a.successRate, 0) / total;
    const latencies = agents.filter(a => a.averageLatencyMs !== null);
    const avgLatency = latencies.length > 0
      ? Math.round(latencies.reduce((s, a) => s + (a.averageLatencyMs ?? 0), 0) / latencies.length)
      : 0;

    const aboveSLA = agents.filter(a => a.successRate >= 99.0).length;

    return {
      avgUptime: `${avgSuccess.toFixed(1)}%`,
      avgResponseTime: `${avgLatency}ms`,
      operatorsAboveSLA: aboveSLA,
      totalOperators: total,
      generatedAt: now.toISOString(),
    };
  } catch {
    return {
      avgUptime: '---',
      avgResponseTime: '---',
      operatorsAboveSLA: 0,
      totalOperators: 0,
      generatedAt: now.toISOString(),
    };
  }
}
