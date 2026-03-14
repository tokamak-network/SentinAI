/**
 * Pattern Miner
 * Extracts operational patterns from experience records
 */

import type { OperationalPattern, OperationRecord } from './playbook-evolution-types';

export class PatternMiner {
  async analyzeAndMine(records: OperationRecord[]): Promise<OperationalPattern[]> {
    if (records.length < 3) {
      return [];
    }

    // Group by anomalyType + action
    const grouped = new Map<string, OperationRecord[]>();
    for (const record of records) {
      const key = `${record.anomalyType}|${record.action}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(record);
    }

    const patterns: OperationalPattern[] = [];

    for (const [key, group] of grouped.entries()) {
      if (group.length < 3) continue; // Need at least 3 occurrences

      const [anomalyType, effectiveAction] = key.split('|');
      const successes = group.filter((r) => r.success).length;
      const successRate = successes / group.length;
      const avgResolutionMs = group.reduce((sum, r) => sum + r.resolutionMs, 0) / group.length;

      // Confidence based on occurrences and success rate
      const occurrenceConfidence = Math.min(1, group.length / 20);
      const successConfidence = successRate;
      const confidence = (occurrenceConfidence + successConfidence) / 2;

      patterns.push({
        id: `pattern-${Date.now()}-${Math.random()}`,
        anomalyType,
        effectiveAction,
        successRate,
        occurrences: group.length,
        confidence,
        avgResolutionMs,
        lastSeen: group[group.length - 1]!.timestamp,
      });
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }
}
