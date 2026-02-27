/**
 * Instance Metrics Store
 * Redis ring buffer for GenericMetricDataPoint per instance.
 * Namespace-isolated: each instance writes to its own Redis keys.
 *
 * Redis key schema:
 *   inst:{instanceId}:metrics:buffer → List (ring buffer, newest-last)
 *
 * Falls back to in-memory Map<instanceId, GenericMetricDataPoint[]> when Redis is not set.
 */

import type { GenericMetricDataPoint, InstanceMetricsStats, MetricFieldStats } from './metrics';
import { getCoreRedis } from './redis';

// ============================================================
// Constants
// ============================================================

const BUFFER_MAX = 60;  // Keep last 60 data points per instance (~30 min at 30s intervals)

// ============================================================
// Key Helpers
// ============================================================

const KEY_BUFFER = (instanceId: string) => `inst:${instanceId}:metrics:buffer`;

// ============================================================
// In-Memory Fallback
// ============================================================

const g = globalThis as unknown as {
  __sentinai_metrics_store?: Map<string, GenericMetricDataPoint[]>;
};

function getMemoryBuffers(): Map<string, GenericMetricDataPoint[]> {
  if (!g.__sentinai_metrics_store) {
    g.__sentinai_metrics_store = new Map();
  }
  return g.__sentinai_metrics_store;
}

// ============================================================
// Public API
// ============================================================

/**
 * Push a new metric data point for an instance.
 * Automatically evicts oldest entry when buffer exceeds BUFFER_MAX.
 */
export async function pushMetric(dataPoint: GenericMetricDataPoint): Promise<void> {
  const redis = getCoreRedis();

  if (redis) {
    const key = KEY_BUFFER(dataPoint.instanceId);
    await redis.rpush(key, JSON.stringify(dataPoint));
    await redis.ltrim(key, -BUFFER_MAX, -1);
    return;
  }

  // In-memory fallback
  const buffers = getMemoryBuffers();
  const buf = buffers.get(dataPoint.instanceId) ?? [];
  buf.push(dataPoint);
  if (buf.length > BUFFER_MAX) buf.splice(0, buf.length - BUFFER_MAX);
  buffers.set(dataPoint.instanceId, buf);
}

/**
 * Get recent metric data points for an instance.
 * Returns up to `count` most recent points (newest last).
 * Returns empty array if no data exists.
 */
export async function getRecentMetrics(
  instanceId: string,
  count?: number
): Promise<GenericMetricDataPoint[]> {
  const redis = getCoreRedis();

  if (redis) {
    const key = KEY_BUFFER(instanceId);
    let items: string[];
    if (count === undefined) {
      items = await redis.lrange(key, 0, -1);
    } else {
      items = await redis.lrange(key, -count, -1);
    }
    return items.map(item => {
      try {
        return JSON.parse(item) as GenericMetricDataPoint;
      } catch {
        return null;
      }
    }).filter((x): x is GenericMetricDataPoint => x !== null);
  }

  // In-memory fallback
  const buf = getMemoryBuffers().get(instanceId) ?? [];
  if (count === undefined) return [...buf];
  return buf.slice(-count);
}

/**
 * Get the most recent data point for an instance.
 * Returns null if no data exists.
 */
export async function getLatestMetric(instanceId: string): Promise<GenericMetricDataPoint | null> {
  const points = await getRecentMetrics(instanceId, 1);
  return points.length > 0 ? points[points.length - 1] : null;
}

/**
 * Get the number of stored data points for an instance.
 */
export async function getMetricsCount(instanceId: string): Promise<number> {
  const redis = getCoreRedis();

  if (redis) {
    return redis.llen(KEY_BUFFER(instanceId));
  }

  return getMemoryBuffers().get(instanceId)?.length ?? 0;
}

/**
 * Clear all metrics for an instance.
 * Called when an instance is deleted.
 */
export async function clearMetrics(instanceId: string): Promise<void> {
  const redis = getCoreRedis();

  if (redis) {
    await redis.del(KEY_BUFFER(instanceId));
    return;
  }

  getMemoryBuffers().delete(instanceId);
}

/**
 * Compute running statistics for all metric fields of an instance.
 * Returns stats over the full buffer window.
 */
export async function getStats(instanceId: string): Promise<InstanceMetricsStats | null> {
  const points = await getRecentMetrics(instanceId);
  if (points.length === 0) return null;

  const lastPoint = points[points.length - 1];

  // Collect all field names across all points
  const allFields = new Set<string>();
  for (const p of points) {
    for (const key of Object.keys(p.fields)) {
      allFields.add(key);
    }
  }

  const fields: Record<string, MetricFieldStats> = {};

  for (const fieldName of allFields) {
    const values = points
      .map(p => p.fields[fieldName])
      .filter((v): v is number => v !== null && v !== undefined);

    if (values.length === 0) {
      fields[fieldName] = {
        fieldName,
        current: null,
        min: 0,
        max: 0,
        mean: 0,
        stdDev: 0,
        trend: 0,
        windowSize: 0,
      };
      continue;
    }

    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const min = Math.min(...values);
    const max = Math.max(...values);

    // Linear regression slope (trend)
    let trend = 0;
    if (values.length >= 3) {
      const n = values.length;
      const xMean = (n - 1) / 2;
      const xValues = Array.from({ length: n }, (_, i) => i);
      const numerator = xValues.reduce((s, x, i) => s + (x - xMean) * (values[i] - mean), 0);
      const denominator = xValues.reduce((s, x) => s + Math.pow(x - xMean, 2), 0);
      trend = denominator !== 0 ? numerator / denominator : 0;
    }

    fields[fieldName] = {
      fieldName,
      current: lastPoint.fields[fieldName] ?? null,
      min,
      max,
      mean,
      stdDev,
      trend,
      windowSize: values.length,
    };
  }

  return {
    instanceId,
    lastUpdatedAt: lastPoint.timestamp,
    fields,
  };
}

/**
 * Delete all metrics data for an instance (alias for clearMetrics, more descriptive).
 * Also removes any related Redis keys for the instance namespace.
 */
export async function deleteInstanceData(instanceId: string): Promise<void> {
  await clearMetrics(instanceId);
}
