/**
 * Operational Snapshot Builder
 *
 * Gathers live SentinAI operational data (metrics, scaling, anomalies, agent status)
 * into a single JSON-serialisable snapshot for ERC8004 on-chain discovery.
 */

import { getRecentMetrics, getMetricsStats } from '@/lib/metrics-store';
import { getScalingState } from '@/lib/k8s-scaler';
import { getEvents as getAnomalyEvents } from '@/lib/anomaly-event-store';
import { getChainPlugin } from '@/chains';
import type { MetricsStoreStats } from '@/types/prediction';
import type { ScalingState } from '@/types/scaling';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface OpsMetricsSummary {
  sampleCount: number;
  latestTimestamp: string | null;
  cpu: { mean: number; max: number; trend: string };
  txPool: { mean: number; max: number; trend: string };
  gasUsedRatio: { mean: number; max: number; trend: string };
  blockInterval: { mean: number; stdDev: number };
}

export interface OpsScalingSummary {
  currentVcpu: number;
  currentMemoryGiB: number;
  autoScalingEnabled: boolean;
  cooldownRemaining: number;
  lastDecisionScore: number | null;
  lastDecisionReason: string | null;
}

export interface OpsAnomalySummary {
  activeCount: number;
  totalRecent: number;
}

export interface OpsChainInfo {
  chainType: string;
  displayName: string;
  chainMode: string;
}

export interface OpsSnapshot {
  version: '1';
  generatedAt: string;
  chain: OpsChainInfo;
  metrics: OpsMetricsSummary;
  scaling: OpsScalingSummary;
  anomalies: OpsAnomalySummary;
}

/* ------------------------------------------------------------------ */
/*  Builder                                                            */
/* ------------------------------------------------------------------ */

function buildMetricsSummary(
  stats: MetricsStoreStats,
  sampleCount: number,
  latestTimestamp: string | null,
): OpsMetricsSummary {
  const s = stats.stats;
  return {
    sampleCount,
    latestTimestamp,
    cpu: {
      mean: round(s.cpu.mean),
      max: round(s.cpu.max),
      trend: s.cpu.trend,
    },
    txPool: {
      mean: round(s.txPool.mean),
      max: round(s.txPool.max),
      trend: s.txPool.trend,
    },
    gasUsedRatio: {
      mean: round(s.gasUsedRatio.mean, 4),
      max: round(s.gasUsedRatio.max, 4),
      trend: s.gasUsedRatio.trend,
    },
    blockInterval: {
      mean: round(s.blockInterval.mean, 2),
      stdDev: round(s.blockInterval.stdDev, 2),
    },
  };
}

function buildScalingSummary(state: ScalingState): OpsScalingSummary {
  return {
    currentVcpu: state.currentVcpu,
    currentMemoryGiB: state.currentMemoryGiB,
    autoScalingEnabled: state.autoScalingEnabled,
    cooldownRemaining: state.cooldownRemaining,
    lastDecisionScore: state.lastDecision?.score ?? null,
    lastDecisionReason: state.lastDecision?.reason ?? null,
  };
}

function buildChainInfo(): OpsChainInfo {
  const plugin = getChainPlugin();
  return {
    chainType: plugin.chainType,
    displayName: plugin.displayName,
    chainMode: plugin.chainMode,
  };
}

export async function buildOpsSnapshot(): Promise<OpsSnapshot> {
  const [recentMetrics, stats, scalingState, anomalyResult] = await Promise.all([
    getRecentMetrics(60),
    getMetricsStats(),
    getScalingState(),
    getAnomalyEvents(20, 0),
  ]);

  const latestTimestamp =
    recentMetrics.length > 0
      ? recentMetrics[recentMetrics.length - 1].timestamp
      : null;

  return {
    version: '1',
    generatedAt: new Date().toISOString(),
    chain: buildChainInfo(),
    metrics: buildMetricsSummary(stats, recentMetrics.length, latestTimestamp),
    scaling: buildScalingSummary(scalingState),
    anomalies: {
      activeCount: anomalyResult.activeCount,
      totalRecent: anomalyResult.total,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
