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

import { getExperienceByInstance, getExperienceStats } from '@/lib/experience-store';
import { extractPatterns } from '@/lib/pattern-extractor';
import type { AgentResume, ExperienceTier } from '@/types/agent-resume';

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
  const stats = await getExperienceStats();
  const entries = await getExperienceByInstance(instanceId, 500);
  const { patterns } = extractPatterns(entries);

  const topPatterns = patterns.slice(0, 5);
  const specialties = [...new Set(topPatterns.map(p => p.trigger.metric))];

  return {
    instanceId,
    protocolId,
    tier: calculateTier(stats.operatingDays),
    operatingSince: entries.length > 0
      ? entries[entries.length - 1].timestamp
      : new Date().toISOString(),
    stats,
    topPatterns,
    specialties,
    generatedAt: new Date().toISOString(),
  };
}
