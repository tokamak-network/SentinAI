/**
 * Collective Intelligence — Cross-Instance Pattern Aggregation
 *
 * Merges patterns from all agent instances by protocol type.
 * Patterns verified by more instances receive higher aggregate confidence.
 *
 * Privacy model:
 *   Shared:     pattern schema + success rate + protocol type + occurrences
 *   Not shared: raw metrics, RPC URLs, operator identity, financial data
 *   All data stays local (self-hosted) — aggregation is per-collection.
 */

import { getExperienceLog } from '@/lib/experience-store';
import { extractPatterns } from '@/lib/pattern-extractor';
import type { ExperienceEntry } from '@/types/experience';
import type { OperationalPattern } from '@/types/pattern';

export interface CollectivePatternEntry {
  signature: string;
  trigger: { type: string; metric: string; valueRange: [number, number] };
  action: string;
  aggregateConfidence: number;
  totalOccurrences: number;
  instanceCount: number;
  successRate: number;
  protocols: string[];
}

export interface CollectivePatternLibrary {
  patterns: CollectivePatternEntry[];
  totalInstances: number;
  aggregatedAt: string;
}

export interface RecommendedAction {
  action: string;
  confidence: number;
  successRate: number;
  evidenceCount: number;
  source: 'collective';
}

/**
 * Aggregate patterns across all instances into a collective library.
 * Patterns found by more instances receive boosted confidence.
 */
export async function aggregatePatterns(): Promise<CollectivePatternLibrary> {
  const allEntries = await getExperienceLog(5000);

  if (allEntries.length === 0) {
    return { patterns: [], totalInstances: 0, aggregatedAt: new Date().toISOString() };
  }

  // Group entries by instanceId to extract patterns per instance
  const byInstance = new Map<string, ExperienceEntry[]>();
  for (const entry of allEntries) {
    const group = byInstance.get(entry.instanceId);
    if (group) group.push(entry);
    else byInstance.set(entry.instanceId, [entry]);
  }

  const totalInstances = byInstance.size;

  // Extract patterns per instance, track which instances have each signature
  const signatureMap = new Map<string, {
    pattern: OperationalPattern;
    instances: Set<string>;
    totalOccurrences: number;
    weightedSuccessSum: number;
  }>();

  for (const [instanceId, entries] of byInstance) {
    const { patterns } = extractPatterns(entries);
    for (const p of patterns) {
      const existing = signatureMap.get(p.signature);
      if (existing) {
        existing.instances.add(instanceId);
        existing.totalOccurrences += p.occurrences;
        existing.weightedSuccessSum += p.successRate * p.occurrences;
        // Widen value range without mutating the original pattern
        const minVal = Math.min(existing.pattern.trigger.valueRange[0], p.trigger.valueRange[0]);
        const maxVal = Math.max(existing.pattern.trigger.valueRange[1], p.trigger.valueRange[1]);
        existing.pattern = {
          ...existing.pattern,
          trigger: { ...existing.pattern.trigger, valueRange: [minVal, maxVal] },
        };
      } else {
        signatureMap.set(p.signature, {
          pattern: p,
          instances: new Set([instanceId]),
          totalOccurrences: p.occurrences,
          weightedSuccessSum: p.successRate * p.occurrences,
        });
      }
    }
  }

  // Build collective patterns with aggregate confidence
  const patterns: CollectivePatternEntry[] = [];
  for (const [signature, data] of signatureMap) {
    const instanceCount = data.instances.size;
    const successRate = data.weightedSuccessSum / data.totalOccurrences;

    // Boost confidence: more instances verifying = higher confidence
    // Formula: base_confidence * (1 + log2(instanceCount) / 5)
    const baseConfidence = data.pattern.confidence;
    const instanceBoost = 1 + Math.log2(Math.max(1, instanceCount)) / 5;
    const aggregateConfidence = Math.min(1, baseConfidence * instanceBoost);

    patterns.push({
      signature,
      trigger: data.pattern.trigger,
      action: data.pattern.action,
      aggregateConfidence,
      totalOccurrences: data.totalOccurrences,
      instanceCount,
      successRate,
      protocols: data.pattern.protocols,
    });
  }

  patterns.sort((a, b) => b.aggregateConfidence - a.aggregateConfidence);

  return {
    patterns,
    totalInstances,
    aggregatedAt: new Date().toISOString(),
  };
}

/**
 * Get recommended actions for a given trigger from the collective library.
 * Matches by trigger type and returns top 3 ranked by confidence × successRate.
 */
export async function getRecommendations(
  triggerType: string,
  protocolId: string,
): Promise<RecommendedAction[]> {
  const library = await aggregatePatterns();

  const matching = library.patterns.filter(
    (p) =>
      p.trigger.type === triggerType &&
      p.protocols.includes(protocolId),
  );

  return matching
    .sort((a, b) => b.aggregateConfidence * b.successRate - a.aggregateConfidence * a.successRate)
    .slice(0, 3)
    .map((p) => ({
      action: p.action,
      confidence: p.aggregateConfidence,
      successRate: p.successRate,
      evidenceCount: p.totalOccurrences,
      source: 'collective' as const,
    }));
}
