/**
 * Daily Accumulator Module (Redis-backed)
 * Accumulates 24-hour metric snapshots from the ring buffer for daily report generation.
 * Takes snapshots every 5 minutes, storing statistical summaries (not raw data) for memory efficiency.
 */

import { getMetricsStats, getRecentMetrics } from '@/lib/metrics-store';
import { getStore } from '@/lib/redis-store';
import type {
  MetricSnapshot,
  HourlySummary,
  DailyAccumulatedData,
  AccumulatorState,
  LogAnalysisEntry,
  ScalingEvent,
  AWSDailyCost,
} from '@/types/daily-report';
import { calculateDailyAWSCost } from './aws-cost-tracker';

const MAX_SNAPSHOTS_PER_DAY = 288; // 24 * 60 / 5
const MIN_SNAPSHOT_GAP_MS = 4 * 60 * 1000; // 4 minutes (dedup guard)

/** Get today's date string in KST (YYYY-MM-DD) */
function getTodayKST(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** Get current hour in KST (0-23) */
export function getCurrentHourKST(): number {
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
export async function initializeAccumulator(): Promise<void> {
  const today = getTodayKST();
  const store = getStore();
  const existing = await store.getDailyAccumulatorState(today);

  if (existing && existing.currentDate === today) {
    return; // Already initialized for today
  }

  const now = new Date().toISOString();
  const newState: AccumulatorState = {
    currentDate: today,
    data: createEmptyData(today),
    lastSnapshotTimestamp: 0,
    startedAt: now,
  };

  await store.setDailyAccumulatorState(today, newState);
  console.log(`[Daily Accumulator] Initialized for ${today}`);
}

/**
 * Take a snapshot from the ring buffer.
 * Returns null if called too frequently (< 4 min gap) or if no data available.
 */
export async function takeSnapshot(): Promise<MetricSnapshot | null> {
  const now = Date.now();
  const today = getTodayKST();
  const store = getStore();

  // Get or initialize state
  let state = await store.getDailyAccumulatorState(today);
  if (!state || state.currentDate !== today) {
    await initializeAccumulator();
    state = await store.getDailyAccumulatorState(today);
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

  const stats = await getMetricsStats();

  // No data in ring buffer
  if (stats.count === 0) {
    console.log('[Daily Accumulator] Ring buffer empty, skipping snapshot');
    return null;
  }

  // Get latest metric for block height and vCPU
  const recentMetrics = await getRecentMetrics(1);
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
  updateDataCompleteness(state);

  // Persist state to store
  await store.setDailyAccumulatorState(today, state);

  console.log(`[Daily Accumulator] Snapshot #${state.data.snapshots.length} taken (${stats.count} data points)`);

  return snapshot;
}

/** Update data completeness calculation */
function updateDataCompleteness(state: AccumulatorState): void {
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
export async function addLogAnalysisResult(entry: LogAnalysisEntry): Promise<void> {
  const today = getTodayKST();
  const store = getStore();

  let state = await store.getDailyAccumulatorState(today);
  if (!state) {
    await initializeAccumulator();
    state = await store.getDailyAccumulatorState(today);
  }
  if (!state) return;

  state.data.logAnalysisResults.push(entry);
  await store.setDailyAccumulatorState(today, state);
}

/**
 * Add a scaling event.
 * Also records vCPU change in the hourly summary.
 */
export async function addScalingEvent(event: ScalingEvent): Promise<void> {
  const today = getTodayKST();
  const store = getStore();

  let state = await store.getDailyAccumulatorState(today);
  if (!state) {
    await initializeAccumulator();
    state = await store.getDailyAccumulatorState(today);
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

  await store.setDailyAccumulatorState(today, state);
}

/**
 * Get accumulated data.
 * Returns null if date doesn't match or not initialized.
 */
export async function getAccumulatedData(date?: string): Promise<DailyAccumulatedData | null> {
  const targetDate = date || getTodayKST();
  const store = getStore();
  const state = await store.getDailyAccumulatorState(targetDate);

  if (!state || state.currentDate !== targetDate) return null;

  // Refresh completeness before returning
  updateDataCompleteness(state);

  // Add AWS cost estimation if not already present
  if (!state.data.awsCost) {
    const { calculateDailyAWSCost } = await import('./aws-cost-tracker');

    // Calculate estimated metrics from snapshots
    const vcpuHours = state.data.snapshots.length > 0
      ? state.data.snapshots.reduce((sum, s) => sum + s.currentVcpu, 0) / state.data.snapshots.length * 24
      : 48;

    state.data.awsCost = calculateDailyAWSCost(targetDate, {
      vcpuHours,
      memGbHours: vcpuHours * 2.5, // Estimated 2.5GB per vCPU
      natDataTransferGb: 1.5,
      cloudwatchLogsGb: 0.5,
      vpcDataTransferGb: 30,
      s3StorageGb: 5,
      s3RequestsPerDay: 10000,
    });
  }

  await store.setDailyAccumulatorState(targetDate, state);

  return state.data;
}

/**
 * Get accumulator status for debugging/API use.
 */
export async function getAccumulatorStatus(): Promise<{
  initialized: boolean;
  currentDate: string | null;
  snapshotCount: number;
  lastSnapshotTime: string | null;
  dataCompleteness: number;
}> {
  const today = getTodayKST();
  const store = getStore();
  const state = await store.getDailyAccumulatorState(today);

  if (!state) {
    return {
      initialized: false,
      currentDate: null,
      snapshotCount: 0,
      lastSnapshotTime: null,
      dataCompleteness: 0,
    };
  }

  updateDataCompleteness(state);
  await store.setDailyAccumulatorState(today, state);

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
export async function resetAccumulator(): Promise<void> {
  const today = getTodayKST();
  const store = getStore();
  await store.deleteDailyAccumulatorState(today);
}
