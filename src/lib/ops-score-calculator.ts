/**
 * Ops Score Calculator
 *
 * Computes a 0-100 operational quality score by combining existing data sources:
 * SLA tracker, reputation store, experience store, and agent resume.
 * No new data collection pipelines — purely aggregation of existing metrics.
 */

import type { OpsBreakdown, PricingBracket } from '@/types/marketplace';
import { getExperienceStats, getLifetimeStats } from '@/lib/experience-store';
import { getAgentMarketplaceReputationScores } from '@/lib/agent-marketplace/reputation-state-store';
import { summarizeAgentMarketplaceSla } from '@/lib/agent-marketplace/sla-tracker';
import { generateResume } from '@/lib/agent-resume';
import logger from '@/lib/logger';

/**
 * Weight configuration for score components.
 * Total must equal 1.0.
 */
const WEIGHTS = {
  sla: 0.30,
  reputation: 0.25,
  successRate: 0.20,
  resolutionSpeed: 0.10,
  volumeMaturity: 0.10,
  domainCoverage: 0.05,
} as const;

/**
 * Calculate the ops score (0-100) for a given agent instance.
 * Combines SLA, reputation, success rate, resolution speed,
 * volume maturity, and domain coverage.
 */
export async function calculateOpsScore(
  instanceId: string,
  protocolId: string,
): Promise<{ opsScore: number; breakdown: OpsBreakdown }> {
  // Collect all data sources in parallel
  const [
    reputationScores,
    slaSummary,
    lifetimeStats,
    resume,
  ] = await Promise.all([
    getAgentMarketplaceReputationScores().catch(() => ({} as Record<string, number>)),
    summarizeAgentMarketplaceSla({
      fromIso: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      toIso: new Date().toISOString(),
      previousScores: {},
    }).catch(() => null),
    getLifetimeStats(instanceId).catch(() => null),
    generateResume(instanceId, protocolId).catch(() => null),
  ]);

  // SLA Score (0-100): direct from sla-tracker
  let slaScore = 50; // default
  if (slaSummary?.agents) {
    const agentSla = slaSummary.agents.find(a => a.agentId === instanceId);
    if (agentSla) {
      slaScore = Math.max(0, Math.min(100, agentSla.newScore));
    }
  }

  // Reputation Score (0-100): direct from reputation-state-store
  const reputationScore = Math.max(0, Math.min(100, reputationScores[instanceId] ?? 50));

  // Success Rate (0-1) from lifetime stats
  let successRate = 0;
  let avgResolutionMs = 0;
  let totalOperations = 0;
  let operatingDays = 0;

  if (lifetimeStats) {
    totalOperations = lifetimeStats.totalOps;
    successRate = totalOperations > 0
      ? lifetimeStats.successCount / totalOperations
      : 0;
    avgResolutionMs = totalOperations > 0
      ? lifetimeStats.totalResolutionMs / totalOperations
      : 0;

    // Calculate operating days from firstSeenAt
    if (lifetimeStats.firstSeenAt) {
      const firstSeen = new Date(lifetimeStats.firstSeenAt).getTime();
      operatingDays = Math.max(0, Math.floor((Date.now() - firstSeen) / (24 * 60 * 60 * 1000)));
    }
  }

  // Domain coverage: count active domains from resume domainStats
  let domainCoverage = 0;
  if (resume?.domainStats) {
    const ds = resume.domainStats;
    if (ds.scaling?.operations > 0) domainCoverage++;
    if (ds.security?.alertsDetected > 0) domainCoverage++;
    if (ds.reliability?.failoversExecuted > 0) domainCoverage++;
    if (ds.rca?.diagnosesRun > 0) domainCoverage++;
    if (ds.cost?.savingsIdentified > 0) domainCoverage++;
  }

  const breakdown: OpsBreakdown = {
    slaScore,
    reputationScore,
    successRate,
    avgResolutionMs,
    totalOperations,
    operatingDays,
    domainCoverage,
  };

  // Normalize each component to 0-100
  const normalizedSuccessRate = successRate * 100;
  const normalizedResolutionSpeed = 100 * Math.max(0, 1 - avgResolutionMs / 60000);
  const normalizedVolumeMaturity = Math.min(100, totalOperations / 10);
  const normalizedDomainCoverage = (domainCoverage / 5) * 100;

  // Weighted average
  const opsScore = Math.round(
    WEIGHTS.sla * slaScore +
    WEIGHTS.reputation * reputationScore +
    WEIGHTS.successRate * normalizedSuccessRate +
    WEIGHTS.resolutionSpeed * normalizedResolutionSpeed +
    WEIGHTS.volumeMaturity * normalizedVolumeMaturity +
    WEIGHTS.domainCoverage * normalizedDomainCoverage,
  );

  const clampedScore = Math.max(0, Math.min(100, opsScore));

  logger.debug('[ops-score-calculator] Score calculated:', {
    instanceId,
    opsScore: clampedScore,
    breakdown,
  });

  return { opsScore: clampedScore, breakdown };
}

/**
 * Resolve the pricing bracket for a given ops score.
 * Brackets must be sorted by floor descending.
 * Returns the first bracket whose floor <= opsScore.
 */
export function resolveBracket(
  opsScore: number,
  brackets: PricingBracket[],
): PricingBracket {
  // Sort by floor descending to ensure correct matching
  const sorted = [...brackets].sort((a, b) => b.floor - a.floor);

  for (const bracket of sorted) {
    if (opsScore >= bracket.floor) {
      return bracket;
    }
  }

  // Fallback: return the bracket with floor=0 or the last one
  return sorted[sorted.length - 1] ?? { floor: 0, priceCents: 0, label: 'Starter' };
}
