/**
 * Pattern Extractor
 *
 * Analyzes ExperienceEntry records to discover repeatable operational patterns.
 * A pattern is: "When [trigger condition], doing [action] has [success rate]
 * over [N occurrences]."
 *
 * Pure function — no side effects, no store access.
 */

import type { ExperienceEntry } from '@/types/experience';
import type { OperationalPattern, PatternExtractionResult } from '@/types/pattern';

const DEFAULT_MIN_OCCURRENCES = 3;

/**
 * Build a grouping signature from an experience entry.
 * Format: "${triggerType}|${metric}|${flooredValue}|${action}"
 */
function buildSignature(entry: ExperienceEntry): string {
  const { type, metric, value } = entry.trigger;
  return `${type}|${metric}|${Math.floor(value)}|${entry.action}`;
}

/**
 * Generate a deterministic pattern ID from signature using simple hash.
 */
function generatePatternId(signature: string): string {
  let hash = 0;
  for (let i = 0; i < signature.length; i++) {
    const char = signature.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `pat-${hex}`;
}

/**
 * Build a human-readable description for a pattern.
 */
function buildDescription(
  trigger: { type: string; metric: string; valueRange: [number, number] },
  action: string,
  successRate: number,
  occurrences: number,
): string {
  const rangeStr =
    trigger.valueRange[0] === trigger.valueRange[1]
      ? `${trigger.valueRange[0]}`
      : `${trigger.valueRange[0]}-${trigger.valueRange[1]}`;

  return (
    `When ${trigger.type} on ${trigger.metric} reaches ${rangeStr}, ` +
    `${action} succeeds ${Math.round(successRate * 100)}% of the time ` +
    `(${occurrences} occurrences)`
  );
}

/**
 * Calculate confidence score from occurrences and success rate.
 * Formula: min(1, (log2(occurrences) / 5) * successRate)
 */
function calculateConfidence(occurrences: number, successRate: number): number {
  return Math.min(1, (Math.log2(occurrences) / 5) * successRate);
}

/**
 * Extract repeatable operational patterns from experience entries.
 *
 * @param entries - Array of ExperienceEntry records to analyze
 * @param minOccurrences - Minimum occurrences to form a pattern (default: 3)
 * @returns PatternExtractionResult with discovered patterns sorted by confidence
 */
export function extractPatterns(
  entries: ExperienceEntry[],
  minOccurrences: number = DEFAULT_MIN_OCCURRENCES,
): PatternExtractionResult {
  // Group entries by signature
  const groups = new Map<string, ExperienceEntry[]>();
  for (const entry of entries) {
    const sig = buildSignature(entry);
    const group = groups.get(sig);
    if (group) {
      group.push(entry);
    } else {
      groups.set(sig, [entry]);
    }
  }

  // Build patterns from groups meeting minimum occurrences
  const patterns: OperationalPattern[] = [];

  for (const [signature, group] of groups) {
    if (group.length < minOccurrences) continue;

    const occurrences = group.length;

    // Success rate
    const successCount = group.filter((e) => e.outcome === 'success').length;
    const successRate = successCount / occurrences;

    // Average resolution time
    const totalResolutionMs = group.reduce((sum, e) => sum + e.resolutionMs, 0);
    const avgResolutionMs = Math.round(totalResolutionMs / occurrences);

    // Value range
    const values = group.map((e) => e.trigger.value);
    const valueRange: [number, number] = [Math.min(...values), Math.max(...values)];

    // Unique protocols
    const protocols = [...new Set(group.map((e) => e.protocolId))].sort();

    // Timestamps
    const timestamps = group.map((e) => e.timestamp).sort();
    const firstSeen = timestamps[0];
    const lastSeen = timestamps[timestamps.length - 1];

    // Trigger info (from first entry — type and metric are shared within group)
    const { type, metric } = group[0].trigger;
    const action = group[0].action;

    const confidence = calculateConfidence(occurrences, successRate);

    const trigger = { type, metric, valueRange };

    patterns.push({
      id: generatePatternId(signature),
      signature,
      description: buildDescription(trigger, action, successRate, occurrences),
      trigger,
      action,
      occurrences,
      successRate,
      avgResolutionMs,
      confidence,
      protocols,
      firstSeen,
      lastSeen,
    });
  }

  // Sort by confidence descending
  patterns.sort((a, b) => b.confidence - a.confidence);

  return {
    patterns,
    totalExperienceAnalyzed: entries.length,
    extractedAt: new Date().toISOString(),
  };
}
