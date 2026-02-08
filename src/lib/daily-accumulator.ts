/**
 * Daily Accumulator Module
 * Accumulates 24-hour metric snapshots from the ring buffer for daily report generation.
 * Takes snapshots every 5 minutes, storing statistical summaries (not raw data) for memory efficiency.
 */

import { getMetricsStats, getRecentMetrics } from '@/lib/metrics-store';
import type {
  MetricSnapshot,
  HourlySummary,
  DailyAccumulatedData,
  AccumulatorState,
  LogAnalysisEntry,
  ScalingEvent,
} from '@/types/daily-report';

const MAX_SNAPSHOTS_PER_DAY = 288; // 24 * 60 / 5
const MIN_SNAPSHOT_GAP_MS = 4 * 60 * 1000; // 4 minutes (dedup guard)

/** Module-level singleton state */
let state: AccumulatorState | null = null;

/** Get today's date string in KST (YYYY-MM-DD) */
function getTodayKST(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** Get current hour in KST (0-23) */
function getCurrentHourKST(): number {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours();
}

/** Create empty hourly summaries for 24 hours */
function createEmptyHourlySummaries(): HourlySummary[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    snapshotCount: 0,
    avgCpu: 0,
    maxCpu: 0,
    avgTxPool: 0,
    maxTxPool: 0,
    avgGasRatio: 0,
    avgBlockInterval: 0,
    blocksProduced: 0,
    vcpuChanges: [],
  }));
}

/** Create empty daily accumulated data */
function createEmptyData(date: string): DailyAccumulatedData {
  return {
    date,
    startTime: new Date().toISOString(),
    lastSnapshotTime: new Date().toISOString(),
    snapshots: [],
    hourlySummaries: createEmptyHourlySummaries(),
    logAnalysisResults: [],
    scalingEvents: [],
    metadata: {
      dataCompleteness: 0,
      dataGaps: [],
    },
  };
}

/**
 * Initialize the accumulator for today.
 * Skips if already initialized for the current date.
 */
export function initializeAccumulator(): void {
  const today = getTodayKST();

  if (state && state.currentDate === today) {
    return; // Already initialized for today
  }

  const now = new Date().toISOString();
  state = {
    currentDate: today,
    data: createEmptyData(today),
    lastSnapshotTimestamp: 0,
    startedAt: now,
  };

  console.log(`[Daily Accumulator] Initialized for ${today}`);
}

/**
 * Take a snapshot from the ring buffer.
 * Returns null if called too frequently (< 4 min gap) or if no data available.
 */
export function takeSnapshot(): MetricSnapshot | null {
  const now = Date.now();
  const today = getTodayKST();

  // Handle date change
  if (!state || state.currentDate !== today) {
    initializeAccumulator();
  }

  if (!state) return null;

  // Dedup guard: skip if less than 4 minutes since last snapshot
  if (now - state.lastSnapshotTimestamp < MIN_SNAPSHOT_GAP_MS) {
    return null;
  }

  // Max snapshots per day guard
  if (state.data.snapshots.length >= MAX_SNAPSHOTS_PER_DAY) {
    return null;
  }

  const stats = getMetricsStats();

  // No data in ring buffer
  if (stats.count === 0) {
    console.log('[Daily Accumulator] Ring buffer empty, skipping snapshot');
    return null;
  }

  // Get latest metric for block height and vCPU
  const recentMetrics = getRecentMetrics(1);
  const latestMetric = recentMetrics[recentMetrics.length - 1];

  const snapshot: MetricSnapshot = {
    timestamp: new Date().toISOString(),
    dataPointCount: stats.count,
    cpu: {
      mean: stats.stats.cpu.mean,
      min: stats.stats.cpu.min,
      max: stats.stats.cpu.max,
      stdDev: stats.stats.cpu.stdDev,
    },
    txPool: {
      mean: stats.stats.txPool.mean,
      min: stats.stats.txPool.min,
      max: stats.stats.txPool.max,
      stdDev: stats.stats.txPool.stdDev,
    },
    gasUsedRatio: {
      mean: stats.stats.gasUsedRatio.mean,
      min: stats.stats.gasUsedRatio.min,
      max: stats.stats.gasUsedRatio.max,
      stdDev: stats.stats.gasUsedRatio.stdDev,
    },
    blockInterval: {
      mean: stats.stats.blockInterval.mean,
      min: stats.stats.blockInterval.min,
      max: stats.stats.blockInterval.max,
      stdDev: stats.stats.blockInterval.stdDev,
    },
    latestBlockHeight: latestMetric?.blockHeight ?? 0,
    currentVcpu: latestMetric?.currentVcpu ?? 1,
  };

  // Store snapshot
  state.data.snapshots.push(snapshot);
  state.data.lastSnapshotTime = snapshot.timestamp;
  state.lastSnapshotTimestamp = now;

  // Update hourly summary
  const hour = getCurrentHourKST();
  const summary = state.data.hourlySummaries[hour];
  const n = summary.snapshotCount;

  summary.avgCpu = (summary.avgCpu * n + snapshot.cpu.mean) / (n + 1);
  summary.maxCpu = Math.max(summary.maxCpu, snapshot.cpu.max);
  summary.avgTxPool = (summary.avgTxPool * n + snapshot.txPool.mean) / (n + 1);
  summary.maxTxPool = Math.max(summary.maxTxPool, snapshot.txPool.max);
  summary.avgGasRatio = (summary.avgGasRatio * n + snapshot.gasUsedRatio.mean) / (n + 1);
  summary.avgBlockInterval = (summary.avgBlockInterval * n + snapshot.blockInterval.mean) / (n + 1);
  summary.snapshotCount = n + 1;

  // Estimate blocks produced in this 5-minute window
  if (snapshot.blockInterval.mean > 0) {
    summary.blocksProduced += Math.round(300 / snapshot.blockInterval.mean);
  }

  // Update data completeness
  updateDataCompleteness();

  console.log(`[Daily Accumulator] Snapshot #${state.data.snapshots.length} taken (${stats.count} data points)`);

  return snapshot;
}

/** Update data completeness calculation */
function updateDataCompleteness(): void {
  if (!state) return;

  const startOfDay = new Date(state.data.startTime).getTime();
  const now = Date.now();
  const elapsedMinutes = (now - startOfDay) / 60000;
  const expectedSnapshots = Math.max(1, Math.floor(elapsedMinutes / 5));
  const actualSnapshots = state.data.snapshots.length;

  state.data.metadata.dataCompleteness = Math.min(1, actualSnapshots / expectedSnapshots);
}

/**
 * Add a log analysis result entry.
 */
export function addLogAnalysisResult(entry: LogAnalysisEntry): void {
  if (!state) {
    initializeAccumulator();
  }
  if (!state) return;

  state.data.logAnalysisResults.push(entry);
}

/**
 * Add a scaling event.
 * Also records vCPU change in the hourly summary.
 */
export function addScalingEvent(event: ScalingEvent): void {
  if (!state) {
    initializeAccumulator();
  }
  if (!state) return;

  state.data.scalingEvents.push(event);

  // Record in hourly summary
  const hour = getCurrentHourKST();
  state.data.hourlySummaries[hour].vcpuChanges.push({
    timestamp: event.timestamp,
    from: event.fromVcpu,
    to: event.toVcpu,
  });
}

/**
 * Get accumulated data.
 * Only returns data for today (in-memory, no persistence).
 * Returns null if date doesn't match or not initialized.
 */
export function getAccumulatedData(date?: string): DailyAccumulatedData | null {
  if (!state) return null;

  const targetDate = date || getTodayKST();
  if (state.currentDate !== targetDate) return null;

  // Refresh completeness before returning
  updateDataCompleteness();

  return state.data;
}

/**
 * Get accumulator status for debugging/API use.
 */
export function getAccumulatorStatus(): {
  initialized: boolean;
  currentDate: string | null;
  snapshotCount: number;
  lastSnapshotTime: string | null;
  dataCompleteness: number;
} {
  if (!state) {
    return {
      initialized: false,
      currentDate: null,
      snapshotCount: 0,
      lastSnapshotTime: null,
      dataCompleteness: 0,
    };
  }

  updateDataCompleteness();

  return {
    initialized: true,
    currentDate: state.currentDate,
    snapshotCount: state.data.snapshots.length,
    lastSnapshotTime: state.data.lastSnapshotTime,
    dataCompleteness: state.data.metadata.dataCompleteness,
  };
}

/**
 * Reset accumulator state (for testing).
 */
export function resetAccumulator(): void {
  state = null;
}
