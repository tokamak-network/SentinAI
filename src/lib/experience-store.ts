/**
 * Experience Store — Operational Knowledge Accumulation
 *
 * Records operational events (scaling, anomaly resolution, RCA, remediation)
 * with full metrics context and trace ID. Foundation for Agent-for-Hire
 * revenue model — agents accumulate verifiable experience over time.
 *
 * Usage:
 *   import { recordExperience, getExperienceLog, getExperienceStats } from '@/lib/experience-store';
 *
 *   await recordExperience({
 *     instanceId: 'inst-1',
 *     protocolId: 'opstack',
 *     category: 'scaling-action',
 *     trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 },
 *     action: 'scale_up 2→4 vCPU',
 *     outcome: 'success',
 *     resolutionMs: 45000,
 *     metricsSnapshot: { cpuUsage: 85, gasUsedRatio: 0.7 },
 *   });
 */

import { getStore } from '@/lib/redis-store';
import { getTraceId } from '@/lib/trace-context';
import { randomUUID } from 'node:crypto';
import logger from '@/lib/logger';
import type { ExperienceEntry, ExperienceStats } from '@/types/experience';

/**
 * Record a new operational experience entry.
 * Automatically attaches a unique ID, timestamp, and the current trace ID.
 */
export async function recordExperience(
  input: Omit<ExperienceEntry, 'id' | 'timestamp' | 'traceId'>
): Promise<ExperienceEntry> {
  const entry: ExperienceEntry = {
    ...input,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    traceId: getTraceId(),
  };

  const store = getStore();
  await store.addExperience(entry);
  logger.debug('[ExperienceStore] Recorded', { category: entry.category, instanceId: entry.instanceId });
  return entry;
}

/**
 * Retrieve recent experience entries (newest first).
 */
export async function getExperienceLog(limit: number = 50, offset: number = 0): Promise<ExperienceEntry[]> {
  const store = getStore();
  return store.getExperience(limit, offset);
}

/**
 * Retrieve experience entries for a specific instance.
 */
export async function getExperienceByInstance(instanceId: string, limit: number = 50): Promise<ExperienceEntry[]> {
  const store = getStore();
  return store.getExperienceByInstance(instanceId, limit);
}

/**
 * Calculate aggregate statistics across all experience entries.
 */
export async function getExperienceStats(): Promise<ExperienceStats> {
  const store = getStore();
  const entries = await store.getExperience(5000);

  if (entries.length === 0) {
    return {
      totalOperations: 0,
      successRate: 0,
      avgResolutionMs: 0,
      topCategories: [],
      operatingDays: 0,
    };
  }

  const successes = entries.filter(e => e.outcome === 'success').length;
  const avgResolution = entries.reduce((sum, e) => sum + e.resolutionMs, 0) / entries.length;

  // Count by category
  const categoryMap = new Map<string, number>();
  for (const e of entries) {
    categoryMap.set(e.category, (categoryMap.get(e.category) || 0) + 1);
  }
  const topCategories = [...categoryMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // Calculate operating days from earliest to latest entry
  const timestamps = entries.map(e => new Date(e.timestamp).getTime());
  const earliest = Math.min(...timestamps);
  const latest = Math.max(...timestamps);
  const operatingDays = Math.max(1, Math.ceil((latest - earliest) / (24 * 60 * 60 * 1000)));

  return {
    totalOperations: entries.length,
    successRate: successes / entries.length,
    avgResolutionMs: avgResolution,
    topCategories,
    operatingDays,
  };
}
