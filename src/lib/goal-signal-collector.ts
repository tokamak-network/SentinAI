/**
 * Goal Signal Collector
 * Collects and normalizes autonomous-goal runtime signals into a deterministic snapshot schema.
 */

import { createHash } from 'crypto';
import { getChainPlugin } from '@/chains';
import { getEvents } from '@/lib/anomaly-event-store';
import { queryAgentMemory } from '@/lib/agent-memory';
import { getScalingState } from '@/lib/k8s-scaler';
import { getActiveL1RpcUrl, getFailoverEvents } from '@/lib/l1-rpc-failover';
import { getRecentMetrics } from '@/lib/metrics-store';
import { getUsageSummary } from '@/lib/usage-tracker';
import type {
  GoalSignalSnapshot,
  GoalSignalTrend,
} from '@/types/goal-manager';
import type { MetricDataPoint } from '@/types/prediction';
import type { ScalingState } from '@/types/scaling';
import type { AgentMemoryEntry } from '@/types/agent-memory';

interface GoalSignalCollectorOptions {
  now?: number;
  metricsWindowSize?: number;
  failoverLookbackMinutes?: number;
  usageWindowDays?: number;
  memoryLookbackMinutes?: number;
}

const DEFAULT_OPTIONS = {
  metricsWindowSize: 10,
  failoverLookbackMinutes: 30,
  usageWindowDays: 7,
  memoryLookbackMinutes: 120,
} as const;

const DEFAULT_SCALING_SIGNAL: ScalingState = {
  currentVcpu: 1,
  currentMemoryGiB: 2,
  lastScalingTime: null,
  lastDecision: null,
  cooldownRemaining: 0,
  autoScalingEnabled: true,
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function safeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function roundTo(value: number, digits: number = 3): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function getTrend(values: number[], epsilon: number): GoalSignalTrend {
  if (values.length < 2) return 'stable';
  const first = values[0];
  const last = values[values.length - 1];
  const diff = last - first;

  if (Math.abs(diff) <= epsilon) return 'stable';
  return diff > 0 ? 'rising' : 'falling';
}

function parseTimestampMs(value: string | number | undefined | null): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string' || value.trim().length === 0) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestIsoFromEntries(entries: Array<{ timestamp?: string | number | null }>): string | null {
  let latest = 0;
  for (const entry of entries) {
    latest = Math.max(latest, parseTimestampMs(entry.timestamp));
  }
  return latest > 0 ? new Date(latest).toISOString() : null;
}

function countCriticalAnomalyEvents(events: Array<{ deepAnalysis?: { severity?: string }; anomalies?: Array<{ zScore: number }> }>): number {
  return events.filter((event) => {
    if (event.deepAnalysis?.severity === 'critical') {
      return true;
    }

    if (!Array.isArray(event.anomalies)) {
      return false;
    }

    return event.anomalies.some((anomaly) => Math.abs(anomaly.zScore) >= 5);
  }).length;
}

function normalizeMemoryStats(memoryEntries: AgentMemoryEntry[]): {
  recentEntryCount: number;
  recentIncidentCount: number;
  recentHighSeverityCount: number;
  latestEntryTimestamp: string | null;
} {
  const incidentCategories = new Set(['incident', 'failover', 'remediation']);

  return {
    recentEntryCount: memoryEntries.length,
    recentIncidentCount: memoryEntries.filter((entry) => incidentCategories.has(entry.category)).length,
    recentHighSeverityCount: memoryEntries.filter((entry) => entry.severity === 'high' || entry.severity === 'critical').length,
    latestEntryTimestamp: latestIsoFromEntries(memoryEntries.map((entry) => ({ timestamp: entry.timestamp }))),
  };
}

async function safeCollect<T>(collector: () => Promise<T>, fallback: T, sourceName: string): Promise<T> {
  try {
    return await collector();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[GoalSignalCollector] ${sourceName} fallback: ${message}`);
    return fallback;
  }
}

export async function collectGoalSignalSnapshot(
  options: GoalSignalCollectorOptions = {}
): Promise<GoalSignalSnapshot> {
  const now = options.now ?? Date.now();
  const metricsWindowSize = clampInt(
    options.metricsWindowSize,
    DEFAULT_OPTIONS.metricsWindowSize,
    3,
    120
  );
  const failoverLookbackMinutes = clampInt(
    options.failoverLookbackMinutes,
    DEFAULT_OPTIONS.failoverLookbackMinutes,
    1,
    1440
  );
  const usageWindowDays = clampInt(
    options.usageWindowDays,
    DEFAULT_OPTIONS.usageWindowDays,
    1,
    30
  );
  const memoryLookbackMinutes = clampInt(
    options.memoryLookbackMinutes,
    DEFAULT_OPTIONS.memoryLookbackMinutes,
    5,
    7 * 24 * 60
  );

  const memoryFromTs = new Date(now - memoryLookbackMinutes * 60 * 1000).toISOString();

  const [
    metrics,
    anomalyResult,
    failoverEvents,
    usageSummary,
    memoryEntries,
    scalingState,
    activeL1RpcUrl,
  ] = await Promise.all([
    safeCollect(
      () => getRecentMetrics(metricsWindowSize),
      [],
      'metrics'
    ),
    safeCollect(
      () => getEvents(100, 0),
      { events: [], total: 0, activeCount: 0 },
      'anomaly'
    ),
    safeCollect(
      async () => getFailoverEvents(),
      [],
      'failover'
    ),
    safeCollect(
      () => getUsageSummary(usageWindowDays),
      {
        avgVcpu: 1,
        peakVcpu: 1,
        avgUtilization: 0,
        dataPointCount: 0,
        oldestDataAge: 0,
      },
      'cost'
    ),
    safeCollect(
      () => queryAgentMemory({ fromTs: memoryFromTs, limit: 300 }),
      [],
      'memory'
    ),
    safeCollect(
      () => getScalingState(),
      DEFAULT_SCALING_SIGNAL,
      'scaling'
    ),
    safeCollect(
      async () => getActiveL1RpcUrl(),
      '',
      'l1-rpc'
    ),
  ]);

  const sortedMetrics = [...metrics].sort((a, b) => parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp));
  const latestMetric: MetricDataPoint | null = sortedMetrics.length > 0
    ? sortedMetrics[sortedMetrics.length - 1]
    : null;

  const cpuValues = sortedMetrics
    .map((metric) => safeNumber(metric.cpuUsage))
    .filter((value): value is number => value !== null);
  const txPoolValues = sortedMetrics
    .map((metric) => safeNumber(metric.txPoolPending))
    .filter((value): value is number => value !== null);
  const gasValues = sortedMetrics
    .map((metric) => safeNumber(metric.gasUsedRatio))
    .filter((value): value is number => value !== null);

  const failoverCutoff = now - failoverLookbackMinutes * 60 * 1000;
  const recentFailoverEvents = failoverEvents.filter((event) => {
    const ts = parseTimestampMs(event.timestamp);
    return ts >= failoverCutoff;
  });

  const activeAnomalyEvents = anomalyResult.events.filter((event) => event.status === 'active');
  const criticalCount = countCriticalAnomalyEvents(activeAnomalyEvents);
  const memoryStats = normalizeMemoryStats(memoryEntries);

  const readOnlyMode = process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true';
  const chainType = getChainPlugin().chainType;
  const collectedAt = new Date(now).toISOString();
  const sources: GoalSignalSnapshot['sources'] = [
    'metrics',
    'anomaly',
    'policy',
    'cost',
    'failover',
    'memory',
  ];

  const snapshotBase = {
    collectedAt,
    chainType,
    sources,
    metrics: {
      latestCpuUsage: latestMetric ? roundTo(latestMetric.cpuUsage, 3) : null,
      latestTxPoolPending: latestMetric ? latestMetric.txPoolPending : null,
      latestGasUsedRatio: latestMetric ? roundTo(latestMetric.gasUsedRatio, 4) : null,
      currentVcpu: scalingState.currentVcpu,
      cooldownRemaining: scalingState.cooldownRemaining,
      cpuTrend: getTrend(cpuValues, 2),
      txPoolTrend: getTrend(txPoolValues, 25),
      gasTrend: getTrend(gasValues, 0.03),
    },
    anomalies: {
      activeCount: anomalyResult.activeCount,
      criticalCount,
      latestEventTimestamp: latestIsoFromEntries(
        anomalyResult.events.map((event) => ({ timestamp: event.timestamp }))
      ),
    },
    failover: {
      recentCount: recentFailoverEvents.length,
      latestEventTimestamp: latestIsoFromEntries(
        failoverEvents.map((event) => ({ timestamp: event.timestamp }))
      ),
      activeL1RpcUrl,
    },
    cost: {
      avgVcpu: roundTo(usageSummary.avgVcpu, 3),
      peakVcpu: usageSummary.peakVcpu,
      avgUtilization: roundTo(usageSummary.avgUtilization, 3),
      dataPointCount: usageSummary.dataPointCount,
    },
    memory: memoryStats,
    policy: {
      readOnlyMode,
      autoScalingEnabled: scalingState.autoScalingEnabled,
    },
  };

  const snapshotId = createHash('sha256')
    .update(JSON.stringify(snapshotBase))
    .digest('hex')
    .slice(0, 24);

  return {
    snapshotId,
    ...snapshotBase,
  };
}
