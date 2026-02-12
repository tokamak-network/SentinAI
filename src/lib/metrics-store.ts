/**
 * Metrics Store Module
 * Ring buffer implementation for time-series metric storage
 * Shared across Predictive Scaling, Anomaly Detection, and Analytics
 *
 * Storage: Redis (if REDIS_URL set) or InMemory (fallback)
 */

import { MetricDataPoint, MetricsStoreStats, MetricStatSummary } from '@/types/prediction';
import { getStore } from '@/lib/redis-store';

/** Threshold for trend detection: slope magnitude below this is "stable" */
const TREND_THRESHOLD = 0.5;

/**
 * Push a new data point to the metrics store
 * Automatically evicts oldest data if buffer is full (max 60)
 */
export async function pushMetric(dataPoint: MetricDataPoint): Promise<void> {
  await getStore().pushMetric(dataPoint);
}

/**
 * Get recent data points from the store
 * Automatically filters out expired seed data based on TTL
 *
 * @param count - Number of recent points to retrieve (default: all)
 * @returns Array of data points, newest last
 */
export async function getRecentMetrics(count?: number): Promise<MetricDataPoint[]> {
  const metrics = await getStore().getRecentMetrics(count);

  // Filter out expired seed data based on seedTtlExpiry
  const now = new Date().toISOString();
  return metrics.filter(metric => {
    if (!metric.seedTtlExpiry) {
      return true; // Keep non-seed metrics
    }
    // Keep seed metric if TTL hasn't expired
    return metric.seedTtlExpiry >= now;
  });
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
  const n = values.length;
  const xMean = (n - 1) / 2;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    const xDiff = i - xMean;
    const yDiff = values[i] - mean;
    numerator += xDiff * yDiff;
    denominator += xDiff * xDiff;
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;

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
 * Fetches all data points from store, then computes stats in-memory
 */
export async function getMetricsStats(): Promise<MetricsStoreStats> {
  const metricsBuffer = await getStore().getRecentMetrics();

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
 */
export async function clearMetrics(): Promise<void> {
  await getStore().clearMetrics();
}

/**
 * Get current buffer size
 */
export async function getMetricsCount(): Promise<number> {
  return getStore().getMetricsCount();
}

/**
 * Export buffer capacity constant for external use
 */
export const METRICS_BUFFER_CAPACITY = 60;
