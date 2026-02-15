/**
 * Usage Tracker Module (Redis-backed)
 * Tracks vCPU usage patterns for cost optimization analysis
 */

import {
  UsageDataPoint,
  UsagePattern,
  HourlyProfile,
} from '@/types/cost';
import { getStore } from './redis-store';

/**
 * Determine whether tracking is enabled via environment variable
 */
function isTrackingEnabled(): boolean {
  return process.env.COST_TRACKING_ENABLED !== 'false';
}

/**
 * Record usage data
 *
 * @param vcpu - Currently allocated vCPU (1, 2, 4, 8, etc.)
 * @param cpuUtilization - Current CPU utilization (0-100)
 */
export async function recordUsage(vcpu: number, cpuUtilization: number): Promise<void> {
  if (!isTrackingEnabled()) {
    return;
  }

  // Exclude stress test mode simulation data (vcpu === 8)
  if (vcpu === 8) {
    return;
  }

  const dataPoint: UsageDataPoint = {
    timestamp: Date.now(),
    vcpu,
    cpuUtilization: Math.min(Math.max(cpuUtilization, 0), 100),
  };

  const store = getStore();
  await store.pushUsageData(dataPoint);
}

/**
 * Retrieve usage data for the specified period
 *
 * @param days - Number of days to query
 * @returns Array of UsageDataPoint for the specified period
 */
export async function getUsageData(days: number): Promise<UsageDataPoint[]> {
  const store = getStore();
  return store.getUsageData(days);
}

/**
 * Get total usage data count (for debugging)
 */
export async function getUsageDataCount(): Promise<number> {
  const store = getStore();
  return store.getUsageDataCount();
}

/**
 * Clear usage data (for testing)
 */
export async function clearUsageData(): Promise<void> {
  const store = getStore();
  await store.clearUsageData();
}

// ============================================================
// Pattern Analysis
// ============================================================

/**
 * Analyze usage patterns by time of day
 *
 * Groups data into 7 days x 24 hours = 168 buckets for statistical analysis
 *
 * @param days - Analysis period in days, default 7
 * @returns Array of UsagePattern (up to 168)
 */
export async function analyzePatterns(days: number = 7): Promise<UsagePattern[]> {
  const data = await getUsageData(days);

  if (data.length === 0) {
    return [];
  }

  // Initialize buckets
  type Bucket = {
    vcpuSum: number;
    vcpuMax: number;
    utilSum: number;
    count: number;
  };

  const buckets: Map<string, Bucket> = new Map();

  // Distribute data into buckets
  for (const point of data) {
    const date = new Date(point.timestamp);
    const dayOfWeek = date.getDay();
    const hourOfDay = date.getHours();
    const key = `${dayOfWeek}-${hourOfDay}`;

    const bucket = buckets.get(key) || {
      vcpuSum: 0,
      vcpuMax: 0,
      utilSum: 0,
      count: 0,
    };

    bucket.vcpuSum += point.vcpu;
    bucket.vcpuMax = Math.max(bucket.vcpuMax, point.vcpu);
    bucket.utilSum += point.cpuUtilization;
    bucket.count += 1;

    buckets.set(key, bucket);
  }

  // Convert buckets to UsagePattern
  const patterns: UsagePattern[] = [];

  buckets.forEach((bucket, key) => {
    const [dayStr, hourStr] = key.split('-');
    const dayOfWeek = parseInt(dayStr, 10);
    const hourOfDay = parseInt(hourStr, 10);

    patterns.push({
      dayOfWeek,
      hourOfDay,
      avgVcpu: Math.round((bucket.vcpuSum / bucket.count) * 100) / 100,
      peakVcpu: bucket.vcpuMax,
      avgUtilization: Math.round((bucket.utilSum / bucket.count) * 100) / 100,
      sampleCount: bucket.count,
    });
  });

  // Sort: by day of week, then by hour
  patterns.sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) {
      return a.dayOfWeek - b.dayOfWeek;
    }
    return a.hourOfDay - b.hourOfDay;
  });

  return patterns;
}

/**
 * Generate 24-hour profile (regardless of day of week)
 *
 * @returns 24 HourlyProfile entries
 */
export async function getHourlyBreakdown(): Promise<HourlyProfile[]> {
  const data = await getUsageData(7);

  if (data.length === 0) {
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      avgVcpu: 1,
      avgUtilization: 0,
    }));
  }

  // Accumulate by hour
  const hourlyBuckets: Array<{ vcpuSum: number; utilSum: number; count: number }> =
    Array.from({ length: 24 }, () => ({ vcpuSum: 0, utilSum: 0, count: 0 }));

  for (const point of data) {
    const hour = new Date(point.timestamp).getHours();
    hourlyBuckets[hour].vcpuSum += point.vcpu;
    hourlyBuckets[hour].utilSum += point.cpuUtilization;
    hourlyBuckets[hour].count += 1;
  }

  return hourlyBuckets.map((bucket, hour) => ({
    hour,
    avgVcpu: bucket.count > 0
      ? Math.round((bucket.vcpuSum / bucket.count) * 100) / 100
      : 1,
    avgUtilization: bucket.count > 0
      ? Math.round((bucket.utilSum / bucket.count) * 100) / 100
      : 0,
  }));
}

/**
 * Usage pattern summary statistics
 *
 * @param days - Analysis period in days
 * @returns Summary statistics
 */
export async function getUsageSummary(days: number = 7): Promise<{
  avgVcpu: number;
  peakVcpu: number;
  avgUtilization: number;
  dataPointCount: number;
  oldestDataAge: number;
}> {
  const data = await getUsageData(days);

  if (data.length === 0) {
    return {
      avgVcpu: 1,
      peakVcpu: 1,
      avgUtilization: 0,
      dataPointCount: 0,
      oldestDataAge: 0,
    };
  }

  let vcpuSum = 0;
  let peakVcpu = 0;
  let utilSum = 0;

  for (const point of data) {
    vcpuSum += point.vcpu;
    peakVcpu = Math.max(peakVcpu, point.vcpu);
    utilSum += point.cpuUtilization;
  }

  const oldestTimestamp = data[0].timestamp;
  const oldestDataAge = (Date.now() - oldestTimestamp) / (1000 * 60 * 60);

  return {
    avgVcpu: Math.round((vcpuSum / data.length) * 100) / 100,
    peakVcpu,
    avgUtilization: Math.round((utilSum / data.length) * 100) / 100,
    dataPointCount: data.length,
    oldestDataAge: Math.round(oldestDataAge * 10) / 10,
  };
}
