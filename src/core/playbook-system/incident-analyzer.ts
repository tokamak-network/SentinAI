import type { AnalyzerOptions, IncidentPattern, OperationRecord } from '@/core/playbook-system/types';

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_MIN_OCCURRENCES = 3;
const DEFAULT_SAMPLE_LIMIT = 10;

function normalizeNumeric(value: number, bucket: number): number {
  return Math.floor(value / bucket) * bucket;
}

export function buildTriggerSignature(record: OperationRecord): string {
  const zScoreBucket =
    typeof record.trigger.zScore === 'number' && Number.isFinite(record.trigger.zScore)
      ? normalizeNumeric(record.trigger.zScore, 0.5)
      : null;

  const metricValueBucket = Number.isFinite(record.trigger.metricValue)
    ? normalizeNumeric(record.trigger.metricValue, 10)
    : 0;

  return [
    record.trigger.anomalyType,
    record.trigger.metricName,
    `z:${zScoreBucket ?? 'na'}`,
    `v:${metricValueBucket}`,
  ].join('|');
}

export function analyzeIncidentPatterns(
  records: OperationRecord[],
  options: AnalyzerOptions = {}
): IncidentPattern[] {
  const nowMs = (options.now ?? new Date()).getTime();
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const minOccurrences = options.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;
  const sampleLimit = options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;

  const cutoffMs = nowMs - windowDays * 24 * 60 * 60 * 1000;

  const scoped = records.filter((record) => {
    const ts = new Date(record.timestamp).getTime();
    return Number.isFinite(ts) && ts >= cutoffMs;
  });

  const grouped = new Map<string, OperationRecord[]>();

  for (const record of scoped) {
    const signature = buildTriggerSignature(record);
    const key = `${record.instanceId}::${signature}::${record.action}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(record);
    grouped.set(key, bucket);
  }

  const patterns: IncidentPattern[] = [];

  for (const [key, group] of grouped.entries()) {
    if (group.length < minOccurrences) continue;

    const [, triggerSignature, action] = key.split('::');
    const successCount = group.filter((r) => r.outcome === 'success').length;
    const avgResolutionMs =
      group.reduce((sum, r) => sum + r.resolutionMs, 0) / Math.max(group.length, 1);

    const samples = [...group]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, sampleLimit);

    patterns.push({
      triggerSignature,
      action,
      occurrences: group.length,
      successRate: successCount / group.length,
      avgResolutionMs,
      samples,
    });
  }

  return patterns.sort((a, b) => {
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
    if (b.successRate !== a.successRate) return b.successRate - a.successRate;
    return a.avgResolutionMs - b.avgResolutionMs;
  });
}
