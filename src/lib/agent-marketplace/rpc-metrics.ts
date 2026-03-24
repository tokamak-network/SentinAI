/**
 * RPC Metrics — request_count, latency_stats, error_rate
 * Aggregates from request-log-store data
 */

import { getAgentMarketplaceRequestLogsByWindow } from '@/lib/agent-marketplace/request-log-store';

export interface RequestCountSnapshot {
  lastHour: number;
  last24h: number;
  peakRps: number;
  trend: 'rising' | 'stable' | 'falling';
  generatedAt: string;
}

export interface LatencyStatsSnapshot {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  unit: 'ms';
  sampleSize: number;
  generatedAt: string;
}

export interface ErrorRateSnapshot {
  totalRequests: number;
  totalErrors: number;
  errorRate: string;
  breakdown: Record<string, number>;
  generatedAt: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export async function composeRequestCountSnapshot(): Promise<RequestCountSnapshot> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [hourLogs, dayLogs] = await Promise.all([
    getAgentMarketplaceRequestLogsByWindow({ fromIso: oneHourAgo, toIso: now.toISOString() }),
    getAgentMarketplaceRequestLogsByWindow({ fromIso: oneDayAgo, toIso: now.toISOString() }),
  ]);

  // Estimate peak RPS from hour logs (bucket into 10s windows)
  const buckets = new Map<number, number>();
  for (const log of hourLogs) {
    const bucket = Math.floor(new Date(log.timestamp).getTime() / 10000);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  const peakPer10s = buckets.size > 0 ? Math.max(...buckets.values()) : 0;
  const peakRps = Math.round(peakPer10s / 10);

  // Trend: compare first half vs second half of day
  const midpoint = new Date(now.getTime() - 12 * 60 * 60 * 1000).getTime();
  const firstHalf = dayLogs.filter(l => new Date(l.timestamp).getTime() < midpoint).length;
  const secondHalf = dayLogs.length - firstHalf;
  const trend = secondHalf > firstHalf * 1.2 ? 'rising' : secondHalf < firstHalf * 0.8 ? 'falling' : 'stable';

  return {
    lastHour: hourLogs.length,
    last24h: dayLogs.length,
    peakRps,
    trend,
    generatedAt: now.toISOString(),
  };
}

export async function composeLatencyStatsSnapshot(): Promise<LatencyStatsSnapshot> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  const logs = await getAgentMarketplaceRequestLogsByWindow({
    fromIso: oneHourAgo,
    toIso: now.toISOString(),
  });

  const latencies = logs
    .filter(l => l.success && l.latencyMs > 0)
    .map(l => l.latencyMs)
    .sort((a, b) => a - b);

  const avg = latencies.length > 0
    ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
    : 0;

  return {
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    avg,
    unit: 'ms',
    sampleSize: latencies.length,
    generatedAt: now.toISOString(),
  };
}

export async function composeErrorRateSnapshot(): Promise<ErrorRateSnapshot> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  const logs = await getAgentMarketplaceRequestLogsByWindow({
    fromIso: oneHourAgo,
    toIso: now.toISOString(),
  });

  const errors = logs.filter(l => !l.success);
  const breakdown: Record<string, number> = {};
  for (const err of errors) {
    const code = err.verificationResult === 'rate_limited' ? '429' : '500';
    breakdown[code] = (breakdown[code] ?? 0) + 1;
  }

  const rate = logs.length > 0
    ? ((errors.length / logs.length) * 100).toFixed(2) + '%'
    : '0.00%';

  return {
    totalRequests: logs.length,
    totalErrors: errors.length,
    errorRate: rate,
    breakdown,
    generatedAt: now.toISOString(),
  };
}
