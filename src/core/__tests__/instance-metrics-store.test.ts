/**
 * Unit Tests for Instance Metrics Store
 * Tests push/get/stats operations in in-memory fallback mode (getCoreRedis returns null).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  pushMetric,
  getRecentMetrics,
  getLatestMetric,
  getMetricsCount,
  clearMetrics,
  getStats,
} from '@/core/instance-metrics-store';
import type { GenericMetricDataPoint } from '@/core/metrics';

// ============================================================
// Mocks
// ============================================================

vi.mock('@/core/redis', () => ({ getCoreRedis: () => null }));

// ============================================================
// Test Helpers
// ============================================================

function makePoint(
  instanceId: string,
  fields: Record<string, number | null>,
  offsetMs = 0
): GenericMetricDataPoint {
  return {
    instanceId,
    timestamp: new Date(Date.now() + offsetMs).toISOString(),
    fields,
  };
}

// ============================================================
// Tests
// ============================================================

describe('InstanceMetricsStore (in-memory mode)', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__sentinai_metrics_store;
  });

  it('pushMetric + getRecentMetrics returns the pushed data points', async () => {
    await pushMetric(makePoint('inst-1', { blockHeight: 100 }));
    await pushMetric(makePoint('inst-1', { blockHeight: 101 }));

    const result = await getRecentMetrics('inst-1');
    expect(result).toHaveLength(2);
    expect(result[1].fields.blockHeight).toBe(101);
  });

  it('getRecentMetrics with count returns last N points', async () => {
    for (let i = 0; i < 10; i++) {
      await pushMetric(makePoint('inst-2', { blockHeight: i }));
    }

    const result = await getRecentMetrics('inst-2', 3);
    expect(result).toHaveLength(3);
    expect(result[2].fields.blockHeight).toBe(9);
    expect(result[0].fields.blockHeight).toBe(7);
  });

  it('buffer max: pushing 65 points keeps only 60', async () => {
    for (let i = 0; i < 65; i++) {
      await pushMetric(makePoint('inst-3', { blockHeight: i }));
    }

    const count = await getMetricsCount('inst-3');
    expect(count).toBe(60);
  });

  it('buffer overflow: oldest points are evicted, newest are retained', async () => {
    for (let i = 0; i < 65; i++) {
      await pushMetric(makePoint('inst-overflow', { value: i }));
    }
    const all = await getRecentMetrics('inst-overflow');
    expect(all[0].fields.value).toBe(5);  // oldest surviving = index 5
    expect(all[59].fields.value).toBe(64); // newest = last pushed
  });

  it('getLatestMetric returns the most recently pushed point', async () => {
    await pushMetric(makePoint('inst-4', { blockHeight: 1 }));
    await pushMetric(makePoint('inst-4', { blockHeight: 99 }));

    const latest = await getLatestMetric('inst-4');
    expect(latest?.fields.blockHeight).toBe(99);
  });

  it('getLatestMetric on empty instance returns null', async () => {
    const latest = await getLatestMetric('inst-empty');
    expect(latest).toBeNull();
  });

  it('clearMetrics empties the buffer for the instance', async () => {
    await pushMetric(makePoint('inst-5', { blockHeight: 100 }));
    await clearMetrics('inst-5');

    expect(await getMetricsCount('inst-5')).toBe(0);
    expect(await getLatestMetric('inst-5')).toBeNull();
  });

  it('getStats on empty instance returns null', async () => {
    const stats = await getStats('inst-nodata');
    expect(stats).toBeNull();
  });

  it('getStats computes correct mean and stdDev for a single field', async () => {
    const values = [10, 20, 30];
    for (const v of values) {
      await pushMetric(makePoint('inst-6', { cpu: v }));
    }

    const stats = await getStats('inst-6');
    expect(stats).not.toBeNull();

    const cpuStats = stats!.fields['cpu'];
    expect(cpuStats.mean).toBeCloseTo(20);
    expect(cpuStats.min).toBe(10);
    expect(cpuStats.max).toBe(30);
    // stdDev for [10, 20, 30] population: sqrt(((10-20)^2 + (20-20)^2 + (30-20)^2)/3) = sqrt(200/3) ≈ 8.165
    expect(cpuStats.stdDev).toBeCloseTo(Math.sqrt(200 / 3));
    expect(cpuStats.windowSize).toBe(3);
  });

  it('getStats.fields.current matches the last pushed value', async () => {
    await pushMetric(makePoint('inst-7', { cpu: 42 }));
    await pushMetric(makePoint('inst-7', { cpu: 77 }));

    const stats = await getStats('inst-7');
    expect(stats!.fields['cpu'].current).toBe(77);
  });

  it('two instances do not interfere with each other', async () => {
    await pushMetric(makePoint('inst-a', { blockHeight: 1000 }));
    await pushMetric(makePoint('inst-b', { blockHeight: 2000 }));

    const a = await getLatestMetric('inst-a');
    const b = await getLatestMetric('inst-b');

    expect(a?.fields.blockHeight).toBe(1000);
    expect(b?.fields.blockHeight).toBe(2000);
    expect(await getMetricsCount('inst-a')).toBe(1);
    expect(await getMetricsCount('inst-b')).toBe(1);
  });

  it('getStats.fields.trend is positive for monotonically increasing values', async () => {
    // Push 5 strictly increasing values
    for (let i = 0; i < 5; i++) {
      await pushMetric(makePoint('inst-trend', { blockHeight: i * 10 }));
    }

    const stats = await getStats('inst-trend');
    expect(stats).not.toBeNull();
    expect(stats!.fields['blockHeight'].trend).toBeGreaterThan(0);
  });
});
