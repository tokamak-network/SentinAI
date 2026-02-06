/**
 * Metrics Store Module
 * Ring buffer implementation for time-series metric storage
 * Shared across Predictive Scaling, Anomaly Detection, and Analytics
 */

import { MetricDataPoint, MetricsStoreStats, MetricStatSummary } from '@/types/prediction';

/** Maximum number of data points to store (1 hour at 1-minute intervals) */
const MAX_DATA_POINTS = 60;

/** Threshold for trend detection: slope magnitude below this is "stable" */
const TREND_THRESHOLD = 0.5;

/** In-memory ring buffer storage */
let metricsBuffer: MetricDataPoint[] = [];

/**
 * Push a new data point to the metrics store
 * Automatically evicts oldest data if buffer is full
 *
 * @param dataPoint - The metric data point to store
 */
export function pushMetric(dataPoint: MetricDataPoint): void {
  metricsBuffer.push(dataPoint);

  // Evict oldest if over capacity
  if (metricsBuffer.length > MAX_DATA_POINTS) {
    metricsBuffer = metricsBuffer.slice(-MAX_DATA_POINTS);
  }
}

/**
 * Get recent data points from the store
 *
 * @param count - Number of recent points to retrieve (default: all)
 * @returns Array of data points, newest last
 */
export function getRecentMetrics(count?: number): MetricDataPoint[] {
  if (count === undefined || count >= metricsBuffer.length) {
    return [...metricsBuffer];
  }
  return metricsBuffer.slice(-count);
}

/**
 * Calculate statistical summary for a numeric array
 */
function calculateStats(values: number[]): MetricStatSummary {
  if (values.length === 0) {
    return {
      mean: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      trend: 'stable',
      slope: 0,
    };
  }

  // Mean
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

  // Standard Deviation
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  const stdDev = Math.sqrt(variance);

  // Min/Max
  const min = Math.min(...values);
  const max = Math.max(...values);

  // Linear Regression for Trend Detection
  // Using least squares method: slope = Σ((x - x̄)(y - ȳ)) / Σ((x - x̄)²)
  const n = values.length;
  const xMean = (n - 1) / 2; // x values are 0, 1, 2, ... n-1

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    const xDiff = i - xMean;
    const yDiff = values[i] - mean;
    numerator += xDiff * yDiff;
    denominator += xDiff * xDiff;
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;

  // Determine trend based on slope magnitude
  let trend: 'rising' | 'falling' | 'stable';
  if (slope > TREND_THRESHOLD) {
    trend = 'rising';
  } else if (slope < -TREND_THRESHOLD) {
    trend = 'falling';
  } else {
    trend = 'stable';
  }

  return {
    mean: Number(mean.toFixed(2)),
    stdDev: Number(stdDev.toFixed(2)),
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    trend,
    slope: Number(slope.toFixed(4)),
  };
}

/**
 * Get comprehensive statistics about stored metrics
 *
 * @returns Statistics including count, time range, and per-metric summaries
 */
export function getMetricsStats(): MetricsStoreStats {
  if (metricsBuffer.length === 0) {
    return {
      count: 0,
      oldestTimestamp: null,
      newestTimestamp: null,
      stats: {
        cpu: calculateStats([]),
        txPool: calculateStats([]),
        gasUsedRatio: calculateStats([]),
        blockInterval: calculateStats([]),
      },
    };
  }

  const cpuValues = metricsBuffer.map(m => m.cpuUsage);
  const txPoolValues = metricsBuffer.map(m => m.txPoolPending);
  const gasValues = metricsBuffer.map(m => m.gasUsedRatio);
  const blockIntervalValues = metricsBuffer.map(m => m.blockInterval);

  return {
    count: metricsBuffer.length,
    oldestTimestamp: metricsBuffer[0].timestamp,
    newestTimestamp: metricsBuffer[metricsBuffer.length - 1].timestamp,
    stats: {
      cpu: calculateStats(cpuValues),
      txPool: calculateStats(txPoolValues),
      gasUsedRatio: calculateStats(gasValues),
      blockInterval: calculateStats(blockIntervalValues),
    },
  };
}

/**
 * Clear all stored metrics
 * Useful for testing or resetting state
 */
export function clearMetrics(): void {
  metricsBuffer = [];
}

/**
 * Get current buffer size
 *
 * @returns Number of data points currently stored
 */
export function getMetricsCount(): number {
  return metricsBuffer.length;
}

/**
 * Export buffer capacity constant for external use
 */
export const METRICS_BUFFER_CAPACITY = MAX_DATA_POINTS;
