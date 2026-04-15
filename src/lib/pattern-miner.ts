import type { OperationRecord, OperationalPattern } from './playbook-evolution-types';

/**
 * In-memory pattern miner for playbook evolution.
 * Groups operation records by (anomalyType, action) and extracts patterns.
 */
export class PatternMiner {
  async analyzeAndMine(records: OperationRecord[]): Promise<OperationalPattern[]> {
    if (records.length < 3) {
      return [];
    }

    const groups = new Map<string, OperationRecord[]>();
    for (const record of records) {
      const key = `${record.anomalyType}::${record.action}`;
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
    }

    const patterns: OperationalPattern[] = [];

    for (const [key, group] of groups) {
      if (group.length < 3) continue;

      const [anomalyType, effectiveAction] = key.split('::') as [string, string];
      const successCount = group.filter((r) => r.success).length;
      const successRate = successCount / group.length;
      const avgResolutionMs =
        group.reduce((sum, r) => sum + r.resolutionMs, 0) / group.length;
      const confidence = successRate * Math.min(1, group.length / 10);

      patterns.push({
        id: `pattern-${anomalyType}-${effectiveAction}`,
        anomalyType,
        effectiveAction,
        successRate,
        occurrences: group.length,
        confidence,
        avgResolutionMs,
        lastSeen: group[group.length - 1]!.timestamp,
      });
    }

    patterns.sort((a, b) => b.confidence - a.confidence);
    return patterns;
  }
}
