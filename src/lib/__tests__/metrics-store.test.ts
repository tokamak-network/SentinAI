/**
 * Unit tests for metrics-store module
 * Tests ring buffer management, statistics calculation, and trend detection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as metricsStore from '@/lib/metrics-store';
import { MetricDataPoint } from '@/types/prediction';

// Mock the redis-store module
vi.mock('@/lib/redis-store', () => {
  const inMemoryMetrics: MetricDataPoint[] = [];

  return {
    getStore: () => ({
      pushMetric: async (dataPoint: MetricDataPoint) => {
        inMemoryMetrics.push(dataPoint);
        // Ring buffer: keep only last 60
        while (inMemoryMetrics.length > 60) {
          inMemoryMetrics.shift();
        }
      },
      getRecentMetrics: async (count?: number) => {
        if (count === undefined) {
          return [...inMemoryMetrics];
        }
        return inMemoryMetrics.slice(-count);
      },
      getMetricsCount: async () => inMemoryMetrics.length,
      clearMetrics: async () => {
        inMemoryMetrics.length = 0;
      },
    }),
  };
});

/**
 * Helper: Create a test metric data point
 */
function createMetric(overrides?: Partial<MetricDataPoint>): MetricDataPoint {
  const now = Date.now();
  return {
    timestamp: now,
    cpuUsage: 25,
    blockHeight: 1000,
    blockInterval: 2,
    txPoolPending: 100,
    gasUsedRatio: 0.5,
    ...overrides,
  };
}

describe('metrics-store', () => {
  beforeEach(async () => {
    // Clear metrics before each test
    await metricsStore.clearMetrics();
  });

  describe('pushMetric & getRecentMetrics', () => {
    it('should push and retrieve a single metric', async () => {
      const metric = createMetric();
      await metricsStore.pushMetric(metric);

      const recent = await metricsStore.getRecentMetrics();
      expect(recent).toHaveLength(1);
      expect(recent[0]).toEqual(metric);
    });

    it('should maintain metrics in chronological order (newest last)', async () => {
      const now = Date.now();
      const metric1 = createMetric({ timestamp: now - 20000 });
      const metric2 = createMetric({ timestamp: now - 10000 });
      const metric3 = createMetric({ timestamp: now });

      await metricsStore.pushMetric(metric1);
      await metricsStore.pushMetric(metric2);
      await metricsStore.pushMetric(metric3);

      const recent = await metricsStore.getRecentMetrics();
      expect(recent).toHaveLength(3);
      expect(recent[0].timestamp).toBe(now - 20000);
      expect(recent[2].timestamp).toBe(now);
    });

    it('should support partial retrieval with count parameter', async () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        await metricsStore.pushMetric(
          createMetric({ timestamp: now - (10 - i) * 1000 })
        );
      }

      const recent = await metricsStore.getRecentMetrics(5);
      expect(recent).toHaveLength(5);
      // Should return 5 most recent
      expect(recent[4].timestamp).toBeLessThanOrEqual(now);
    });
  });

  describe('Ring buffer capacity', () => {
    it('should evict oldest metrics when exceeding 60 capacity', async () => {
      const now = Date.now();
      // Push 70 metrics
      for (let i = 0; i < 70; i++) {
        await metricsStore.pushMetric(
          createMetric({ timestamp: now - (70 - i) * 1000 })
        );
      }

      const count = await metricsStore.getMetricsCount();
      expect(count).toBe(60);

      // Oldest 10 should be evicted
      const recent = await metricsStore.getRecentMetrics();
      const oldestTimestamp = recent[0].timestamp;
      expect(oldestTimestamp).toBeGreaterThan(now - 70 * 1000);
    });

    it('should preserve newest metrics when exceeding capacity', async () => {
      const now = Date.now();
      for (let i = 0; i < 70; i++) {
        await metricsStore.pushMetric(
          createMetric({ timestamp: now - (70 - i) * 1000 })
        );
      }

      const recent = await metricsStore.getRecentMetrics();
      const newestTimestamp = recent[recent.length - 1].timestamp;
      // Newest should still be at or very close to 'now'
      expect(newestTimestamp).toBeGreaterThanOrEqual(now - 1000);
    });
  });

  describe('getMetricsStats - Statistical calculations', () => {
    it('should calculate mean correctly', async () => {
      const now = Date.now();
      const cpuValues = [10, 20, 30, 40, 50];
      for (let i = 0; i < cpuValues.length; i++) {
        await metricsStore.pushMetric(
          createMetric({
            timestamp: now - (cpuValues.length - i) * 1000,
            cpuUsage: cpuValues[i],
          })
        );
      }

      const stats = await metricsStore.getMetricsStats();
      expect(stats.stats.cpu.mean).toBe(30); // (10+20+30+40+50)/5 = 30
    });

    it('should calculate standard deviation correctly', async () => {
      const now = Date.now();
      // Values: 1, 3, 5 → mean=3, variance=2.67, stdDev≈1.63
      const cpuValues = [1, 3, 5];
      for (let i = 0; i < cpuValues.length; i++) {
        await metricsStore.pushMetric(
          createMetric({
            timestamp: now - (cpuValues.length - i) * 1000,
            cpuUsage: cpuValues[i],
          })
        );
      }

      const stats = await metricsStore.getMetricsStats();
      expect(stats.stats.cpu.stdDev).toBeCloseTo(1.63, 1);
    });

    it('should calculate min and max correctly', async () => {
      const now = Date.now();
      const cpuValues = [15, 8, 42, 23, 5];
      for (let i = 0; i < cpuValues.length; i++) {
        await metricsStore.pushMetric(
          createMetric({
            timestamp: now - (cpuValues.length - i) * 1000,
            cpuUsage: cpuValues[i],
          })
        );
      }

      const stats = await metricsStore.getMetricsStats();
      expect(stats.stats.cpu.min).toBe(5);
      expect(stats.stats.cpu.max).toBe(42);
    });

    it('should track timestamp boundaries correctly', async () => {
      const now = Date.now();
      const timestamp1 = now - 50000;
      const timestamp2 = now;

      await metricsStore.pushMetric(createMetric({ timestamp: timestamp1 }));
      await metricsStore.pushMetric(createMetric({ timestamp: timestamp2 }));

      const stats = await metricsStore.getMetricsStats();
      expect(stats.oldestTimestamp).toBe(timestamp1);
      expect(stats.newestTimestamp).toBe(timestamp2);
      expect(stats.count).toBe(2);
    });
  });

  describe('Trend detection (linear regression)', () => {
    it('should detect rising trend when slope > 0.5', async () => {
      const now = Date.now();
      // Rising values: 10, 15, 20, 25, 30 → strong positive slope
      const cpuValues = [10, 15, 20, 25, 30];
      for (let i = 0; i < cpuValues.length; i++) {
        await metricsStore.pushMetric(
          createMetric({
            timestamp: now - (cpuValues.length - i) * 1000,
            cpuUsage: cpuValues[i],
          })
        );
      }

      const stats = await metricsStore.getMetricsStats();
      expect(stats.stats.cpu.trend).toBe('rising');
      expect(stats.stats.cpu.slope).toBeGreaterThan(0.5);
    });

    it('should detect falling trend when slope < -0.5', async () => {
      const now = Date.now();
      // Falling values: 50, 40, 30, 20, 10 → strong negative slope
      const cpuValues = [50, 40, 30, 20, 10];
      for (let i = 0; i < cpuValues.length; i++) {
        await metricsStore.pushMetric(
          createMetric({
            timestamp: now - (cpuValues.length - i) * 1000,
            cpuUsage: cpuValues[i],
          })
        );
      }

      const stats = await metricsStore.getMetricsStats();
      expect(stats.stats.cpu.trend).toBe('falling');
      expect(stats.stats.cpu.slope).toBeLessThan(-0.5);
    });

    it('should detect stable trend when |slope| <= 0.5', async () => {
      const now = Date.now();
      // Nearly constant values: 25, 25.5, 25.2, 25.8, 25.3 → near-zero slope
      const cpuValues = [25, 25.5, 25.2, 25.8, 25.3];
      for (let i = 0; i < cpuValues.length; i++) {
        await metricsStore.pushMetric(
          createMetric({
            timestamp: now - (cpuValues.length - i) * 1000,
            cpuUsage: cpuValues[i],
          })
        );
      }

      const stats = await metricsStore.getMetricsStats();
      expect(stats.stats.cpu.trend).toBe('stable');
      expect(Math.abs(stats.stats.cpu.slope)).toBeLessThanOrEqual(0.5);
    });
  });

  describe('Multi-metric statistics', () => {
    it('should calculate stats for all 4 metrics simultaneously', async () => {
      const now = Date.now();
      const metrics = [
        createMetric({
          timestamp: now - 2000,
          cpuUsage: 20,
          txPoolPending: 80,
          gasUsedRatio: 0.4,
          blockInterval: 1.8,
        }),
        createMetric({
          timestamp: now,
          cpuUsage: 40,
          txPoolPending: 120,
          gasUsedRatio: 0.6,
          blockInterval: 2.2,
        }),
      ];

      for (const m of metrics) {
        await metricsStore.pushMetric(m);
      }

      const stats = await metricsStore.getMetricsStats();
      expect(stats.stats.cpu.mean).toBe(30);
      expect(stats.stats.txPool.mean).toBe(100);
      expect(stats.stats.gasUsedRatio.mean).toBe(0.5);
      expect(stats.stats.blockInterval.mean).toBe(2);
    });
  });

  describe('Empty buffer handling', () => {
    it('should handle empty buffer gracefully', async () => {
      const stats = await metricsStore.getMetricsStats();
      expect(stats.count).toBe(0);
      expect(stats.oldestTimestamp).toBeNull();
      expect(stats.newestTimestamp).toBeNull();
      expect(stats.stats.cpu.mean).toBe(0);
      expect(stats.stats.cpu.stdDev).toBe(0);
      expect(stats.stats.cpu.trend).toBe('stable');
    });

    it('should return empty array for empty buffer', async () => {
      const recent = await metricsStore.getRecentMetrics();
      expect(recent).toHaveLength(0);
    });

    it('should return 0 count for empty buffer', async () => {
      const count = await metricsStore.getMetricsCount();
      expect(count).toBe(0);
    });
  });

  describe('clearMetrics', () => {
    it('should remove all metrics', async () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        await metricsStore.pushMetric(
          createMetric({ timestamp: now - (5 - i) * 1000 })
        );
      }

      let count = await metricsStore.getMetricsCount();
      expect(count).toBe(5);

      await metricsStore.clearMetrics();

      count = await metricsStore.getMetricsCount();
      expect(count).toBe(0);

      const recent = await metricsStore.getRecentMetrics();
      expect(recent).toHaveLength(0);
    });
  });

  describe('Integration: Complex metric patterns', () => {
    it('should handle rapid metric bursts (10+ per second simulation)', async () => {
      const now = Date.now();
      const burstSize = 20;
      for (let i = 0; i < burstSize; i++) {
        await metricsStore.pushMetric(
          createMetric({
            timestamp: now - (burstSize - i) * 100, // 100ms intervals
            cpuUsage: 20 + Math.random() * 10,
          })
        );
      }

      const stats = await metricsStore.getMetricsStats();
      expect(stats.count).toBe(burstSize);
      expect(stats.stats.cpu.mean).toBeGreaterThan(20);
      expect(stats.stats.cpu.mean).toBeLessThan(31);
    });

    it('should preserve statistics accuracy after capacity overflow', async () => {
      const now = Date.now();
      // Fill buffer to 60, then add 20 more to trigger eviction
      for (let i = 0; i < 80; i++) {
        await metricsStore.pushMetric(
          createMetric({
            timestamp: now - (80 - i) * 1000,
            cpuUsage: 20 + (i % 30), // Repeating pattern 20-50
          })
        );
      }

      const stats = await metricsStore.getMetricsStats();
      // Should have exactly 60 metrics after eviction
      expect(stats.count).toBe(60);
      // Mean should be around 35 (middle of 20-50 pattern)
      expect(stats.stats.cpu.mean).toBeGreaterThan(30);
      expect(stats.stats.cpu.mean).toBeLessThan(40);
    });
  });
});
