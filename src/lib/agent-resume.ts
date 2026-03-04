/**
 * Agent Resume Generator
 *
 * Generates a public-facing profile of an agent's operational experience.
 * Reads from Experience Store (operational history) and Pattern Extractor
 * (discovered repeatable patterns) to produce a structured resume.
 *
 * Tier calculation:
 *   - trainee: < 30 days
 *   - junior:  30-89 days
 *   - senior:  90-179 days
 *   - expert:  180+ days
 *
 * Usage:
 *   import { generateResume } from '@/lib/agent-resume';
 *   const resume = await generateResume('inst-1', 'opstack');
 */

import { getExperienceByInstance, getExperienceStats, getLifetimeStats, lifetimeToExperienceStats } from '@/lib/experience-store';
import { extractPatterns } from '@/lib/pattern-extractor';
import { DOMAIN_CATEGORY_MAP } from '@/types/experience';
import type { AgentResume, DomainStats, ExperienceTier } from '@/types/agent-resume';
import type { ExperienceEntry } from '@/types/experience';

/**
 * Determine experience tier based on operating days.
 */
export function calculateTier(operatingDays: number): ExperienceTier {
  if (operatingDays >= 180) return 'expert';
  if (operatingDays >= 90) return 'senior';
  if (operatingDays >= 30) return 'junior';
  return 'trainee';
}

/**
 * Generate a complete agent resume for a given instance.
 *
 * @param instanceId - The agent instance identifier
 * @param protocolId - The protocol this agent operates on (e.g., 'opstack')
 * @returns AgentResume with tier, stats, top patterns, and specialties
 */
export async function generateResume(
  instanceId: string,
  protocolId: string
): Promise<AgentResume> {
  // Lifetime stats preferred — survives log rotation. Fallback to raw log.
  const [lifetime, entries] = await Promise.all([
    getLifetimeStats(instanceId),
    getExperienceByInstance(instanceId, 500),
  ]);
  const stats = lifetime ? lifetimeToExperienceStats(lifetime) : await getExperienceStats();
  const { patterns } = extractPatterns(entries);

  const topPatterns = patterns.slice(0, 5);
  const specialties = [...new Set(topPatterns.map(p => p.trigger.metric))];

  const domainStats = computeDomainStats(entries);

  return {
    instanceId,
    protocolId,
    tier: calculateTier(stats.operatingDays),
    operatingSince: lifetime?.firstSeenAt
      ?? (entries.length > 0 ? entries[entries.length - 1].timestamp : new Date().toISOString()),
    stats,
    topPatterns,
    specialties,
    domainStats,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Compute per-domain statistics from experience entries.
 * Returns undefined if no domain-specific entries exist.
 */
function computeDomainStats(entries: ExperienceEntry[]): DomainStats | undefined {
  const domainCategoryValues = Object.values(DOMAIN_CATEGORY_MAP);

  const hasDomainEntries = entries.some(e =>
    (domainCategoryValues as string[]).includes(e.category)
  );

  if (!hasDomainEntries) return undefined;

  function statsFor(category: string): ExperienceEntry[] {
    return entries.filter(e => e.category === category);
  }

  function successRate(domainEntries: ExperienceEntry[]): number {
    if (domainEntries.length === 0) return 0;
    return domainEntries.filter(e => e.outcome === 'success').length / domainEntries.length;
  }

  const scalingEntries = statsFor(DOMAIN_CATEGORY_MAP.scaling);
  const securityEntries = statsFor(DOMAIN_CATEGORY_MAP.security);
  const reliabilityEntries = statsFor(DOMAIN_CATEGORY_MAP.reliability);
  const rcaEntries = statsFor(DOMAIN_CATEGORY_MAP.rca);
  const costEntries = statsFor(DOMAIN_CATEGORY_MAP.cost);

  return {
    scaling: {
      operations: scalingEntries.length,
      successRate: successRate(scalingEntries),
    },
    security: {
      alertsDetected: securityEntries.length,
      falsePositiveRate: securityEntries.length > 0
        ? securityEntries.filter(e => e.outcome === 'failure').length / securityEntries.length
        : 0,
    },
    reliability: {
      failoversExecuted: reliabilityEntries.length,
      uptimePercent: reliabilityEntries.length > 0
        ? successRate(reliabilityEntries) * 100
        : 100,
    },
    rca: {
      diagnosesRun: rcaEntries.length,
      accuracyRate: successRate(rcaEntries),
    },
    cost: {
      savingsIdentified: costEntries.length,
      savingsExecuted: costEntries.filter(e => e.outcome === 'success').length,
    },
  };
}
