/**
 * Unit Tests for Anomaly Detector (Layer 1: Statistical Detection)
 *
 * Tests Z-Score detection, rule-based detection (zero-drop, plateau, monotonic-increase)
 * and their integration in the main detectAnomalies() function.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateZScore,
  detectAnomalies,
  getDetectorConfig,
} from '@/lib/anomaly-detector';
import type { MetricDataPoint } from '@/types/prediction';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Generate a metric data point with optional overrides
 */
function createMetric(overrides?: Partial<MetricDataPoint>): MetricDataPoint {
  const now = Date.now();
  return {
    timestamp: now,
    l1BlockNumber: 1000,
    l1BlockTime: 12,
    blockHeight: 5000,
    blockInterval: 2,
    cpuUsage: 30,
    gasUsedRatio: 0.5,
    txPoolPending: 10,
    ...overrides,
  };
}

/**
 * Generate a history of metric data points with a given pattern
 * Generates stable data with controlled variance
 */
function generateHistory(
  length: number,
  baseValues: {
    cpuUsage?: number;
    blockHeight?: number;
    blockInterval?: number;
    txPoolPending?: number;
    gasUsedRatio?: number;
  } = {}
): MetricDataPoint[] {
  const history: MetricDataPoint[] = [];
  const now = Date.now();

  const cpuBase = baseValues.cpuUsage ?? 20;
  const blockBase = baseValues.blockHeight ?? 5000;
  const intervalBase = baseValues.blockInterval ?? 2;
  const txBase = baseValues.txPoolPending ?? 10;
  const gasBase = baseValues.gasUsedRatio ?? 0.5;

  for (let i = 0; i < length; i++) {
    // Add small random variance (±2%) to simulate realistic data
    const randomVariance = (Math.random() - 0.5) * 0.04; // ±2%

    history.push(
      createMetric({
        timestamp: now - (length - i) * 10000, // 10 seconds apart
        cpuUsage: cpuBase * (1 + randomVariance),
        blockHeight: blockBase + i,
        blockInterval: intervalBase * (1 + randomVariance),
        txPoolPending: txBase * (1 + randomVariance),
        gasUsedRatio: gasBase * (1 + randomVariance),
      })
    );
  }

  return history;
}

// ============================================================================
// Test Suites
// ============================================================================

describe('anomaly-detector', () => {
  // ========================================================================
  // Test Suite 1: Z-Score Calculation
  // ========================================================================

  describe('calculateZScore', () => {
    it('should calculate Z-Score correctly with positive deviation', () => {
      const value = 30;
      const mean = 20;
      const stdDev = 5;

      const zScore = calculateZScore(value, mean, stdDev);

      expect(zScore).toBe(2); // (30 - 20) / 5 = 2
    });

    it('should calculate Z-Score correctly with negative deviation', () => {
      const value = 10;
      const mean = 20;
      const stdDev = 5;

      const zScore = calculateZScore(value, mean, stdDev);

      expect(zScore).toBe(-2); // (10 - 20) / 5 = -2
    });

    it('should return 0 when standard deviation is 0', () => {
      const value = 30;
      const mean = 20;
      const stdDev = 0;

      const zScore = calculateZScore(value, mean, stdDev);

      expect(zScore).toBe(0);
    });

    it('should return 0 when value equals mean', () => {
      const value = 20;
      const mean = 20;
      const stdDev = 5;

      const zScore = calculateZScore(value, mean, stdDev);

      expect(zScore).toBe(0);
    });
  });

  // ========================================================================
  // Test Suite 2: Z-Score Anomaly Detection (CPU, TxPool, Gas, Interval)
  // ========================================================================

  describe('Z-Score Spike Detection (CPU)', () => {
    it('should detect CPU spike when Z-Score > 3.0', () => {
      // Create stable history: 10, 11, 12, 13, 14, 15, 16, 17, 18, 19
      // Mean = 14.5, StdDev ≈ 3.03
      const history = generateHistory(10, { cpuUsage: 14 });
      // Spike to 28 → Z = (28 - 14.5) / 3.03 ≈ 4.5 (> 3.0)
      const current = createMetric({ cpuUsage: 28 });

      const anomalies = detectAnomalies(current, history);
      const cpuAnomaly = anomalies.find(a => a.metric === 'cpuUsage');

      expect(cpuAnomaly).toBeDefined();
      expect(cpuAnomaly?.direction).toBe('spike');
      expect(cpuAnomaly?.isAnomaly).toBe(true);
    });

    it('should not detect anomaly when Z-Score is within threshold', () => {
      // Create large values with high variance (more realistic)
      // History: 90, 91, 92, 93, 94, 95, 96, 97, 98, 99
      // Mean ≈ 94.5, StdDev ≈ 3.03
      const history = generateHistory(10, { cpuUsage: 94 });
      // Current = 95 → Z = (95 - 94.5) / 3.03 ≈ 0.16 (< 3.0)
      const current = createMetric({ cpuUsage: 95 });

      const anomalies = detectAnomalies(current, history);
      const cpuAnomaly = anomalies.find(a => a.metric === 'cpuUsage' && a.rule === 'z-score');

      expect(cpuAnomaly).toBeUndefined();
    });
  });

  describe('Z-Score Drop Detection (CPU)', () => {
    it('should detect CPU drop when Z-Score < -3.0', () => {
      // Create stable history around 50: 45, 46, 47, 48, 49, 50, 51, 52, 53, 54
      // Mean = 49.5, StdDev ≈ 3.03
      const history = generateHistory(10, { cpuUsage: 49 });
      // Drop to 20 → Z = (20 - 49.5) / 3.03 ≈ -9.7 (< -2.5)
      const current = createMetric({ cpuUsage: 20 });

      const anomalies = detectAnomalies(current, history);
      const cpuAnomaly = anomalies.find(a => a.metric === 'cpuUsage');

      expect(cpuAnomaly).toBeDefined();
      expect(cpuAnomaly?.direction).toBe('drop');
    });
  });

  describe('Z-Score Detection (Other Metrics)', () => {
    it('should detect TxPool spike', () => {
      // Create stable history around 10
      const history = generateHistory(10, { txPoolPending: 10 });
      // Spike to 40 (extreme value for Z > 3.0)
      const current = createMetric({ txPoolPending: 40 });

      const anomalies = detectAnomalies(current, history);
      const txAnomaly = anomalies.find(a => a.metric === 'txPoolPending');

      expect(txAnomaly).toBeDefined();
      expect(txAnomaly?.isAnomaly).toBe(true);
    });

    it('should detect gas ratio spike', () => {
      // Create stable history around 0.5
      const history = generateHistory(10, { gasUsedRatio: 0.5 });
      // Spike to 1.5 (extreme value)
      const current = createMetric({ gasUsedRatio: 1.5 });

      const anomalies = detectAnomalies(current, history);
      const gasAnomaly = anomalies.find(a => a.metric === 'gasUsedRatio');

      expect(gasAnomaly).toBeDefined();
      expect(gasAnomaly?.isAnomaly).toBe(true);
    });

    it('should detect block interval spike', () => {
      // Create stable history around 2
      const history = generateHistory(10, { blockInterval: 2 });
      // Spike to 8 (extreme value)
      const current = createMetric({ blockInterval: 8 });

      const anomalies = detectAnomalies(current, history);
      const intervalAnomaly = anomalies.find(a => a.metric === 'l2BlockInterval');

      expect(intervalAnomaly).toBeDefined();
      expect(intervalAnomaly?.isAnomaly).toBe(true);
    });
  });

  // ========================================================================
  // Test Suite 3: CPU Zero-Drop Detection
  // ========================================================================

  describe('CPU Zero-Drop Rule', () => {
    it('should detect CPU 0% drop when previous avg >= 10%', () => {
      const history = generateHistory(5, { cpuUsage: 50 });
      const current = createMetric({ cpuUsage: 0 });

      const anomalies = detectAnomalies(current, history);
      const zeroDropAnomaly = anomalies.find(a => a.rule === 'zero-drop');

      expect(zeroDropAnomaly).toBeDefined();
      expect(zeroDropAnomaly?.metric).toBe('cpuUsage');
      expect(zeroDropAnomaly?.direction).toBe('drop');
      expect(zeroDropAnomaly?.description).toContain('Suspected process crash');
    });

    it('should not detect zero-drop when previous avg < 10%', () => {
      const history = generateHistory(5, { cpuUsage: 5 });
      const current = createMetric({ cpuUsage: 0 });

      const anomalies = detectAnomalies(current, history);
      const zeroDropAnomaly = anomalies.find(a => a.rule === 'zero-drop');

      expect(zeroDropAnomaly).toBeUndefined();
    });

    it('should require at least 3 history points for zero-drop detection', () => {
      const history = generateHistory(2, { cpuUsage: 50 });
      const current = createMetric({ cpuUsage: 0 });

      const anomalies = detectAnomalies(current, history);

      // Should not detect zero-drop with only 2 history points
      expect(anomalies.length).toBe(0);
    });
  });

  // ========================================================================
  // Test Suite 4: Block Plateau Detection
  // ========================================================================

  describe('Block Plateau Rule', () => {
    it('should detect block plateau when height unchanged for 120+ seconds', () => {
      const now = Date.now();
      const baseHeight = 5000;

      // Create history with same block height, spaced 30 seconds apart for 5 points
      const history: MetricDataPoint[] = [];
      for (let i = 0; i < 5; i++) {
        history.push(
          createMetric({
            timestamp: now - (5 - i) * 30 * 1000, // 30 seconds apart
            blockHeight: baseHeight,
          })
        );
      }

      const current = createMetric({ blockHeight: baseHeight });

      const anomalies = detectAnomalies(current, history);
      const plateauAnomaly = anomalies.find(a => a.rule === 'plateau');

      expect(plateauAnomaly).toBeDefined();
      expect(plateauAnomaly?.metric).toBe('l2BlockHeight');
      expect(plateauAnomaly?.direction).toBe('plateau');
      expect(plateauAnomaly?.description).toContain('Sequencer stall');
    });

    it('should not detect plateau when block height is changing', () => {
      const history = generateHistory(5, { blockHeight: 5000 }); // Incrementing
      const current = createMetric({ blockHeight: 5005 });

      const anomalies = detectAnomalies(current, history);
      const plateauAnomaly = anomalies.find(a => a.rule === 'plateau');

      expect(plateauAnomaly).toBeUndefined();
    });

    it('should not detect plateau if time window < 120 seconds', () => {
      const now = Date.now();

      // Create history with same height, spaced 20 seconds apart (< 120 seconds total)
      const history: MetricDataPoint[] = [];
      for (let i = 0; i < 3; i++) {
        history.push(
          createMetric({
            timestamp: now - (3 - i) * 20 * 1000,
            blockHeight: 5000,
          })
        );
      }

      const current = createMetric({ blockHeight: 5000 });

      const anomalies = detectAnomalies(current, history);
      const plateauAnomaly = anomalies.find(a => a.rule === 'plateau');

      expect(plateauAnomaly).toBeUndefined();
    });
  });

  // ========================================================================
  // Test Suite 5: TxPool Monotonic Increase Detection
  // ========================================================================

  describe('TxPool Monotonic Increase Rule', () => {
    it('should detect monotonically increasing TxPool for 300+ seconds', () => {
      const now = Date.now();

      // Create monotonically increasing TxPool history (60 seconds apart for 5 points)
      const history: MetricDataPoint[] = [];
      for (let i = 0; i < 5; i++) {
        history.push(
          createMetric({
            timestamp: now - (5 - i) * 60 * 1000,
            txPoolPending: 10 + i * 5, // 10, 15, 20, 25, 30
          })
        );
      }

      const current = createMetric({ txPoolPending: 35 }); // Continue increasing

      const anomalies = detectAnomalies(current, history);
      const monotopicAnomaly = anomalies.find(a => a.rule === 'monotonic-increase');

      expect(monotopicAnomaly).toBeDefined();
      expect(monotopicAnomaly?.metric).toBe('txPoolPending');
      expect(monotopicAnomaly?.description).toContain('Batcher failure');
    });

    it('should not detect monotonic increase when TxPool decreases', () => {
      const now = Date.now();

      // Create history where TxPool increases then decreases
      const history: MetricDataPoint[] = [];
      for (let i = 0; i < 5; i++) {
        const value = i < 3 ? 10 + i * 5 : 10 + (5 - i) * 5; // 10, 15, 20, 15, 10
        history.push(
          createMetric({
            timestamp: now - (5 - i) * 60 * 1000,
            txPoolPending: value,
          })
        );
      }

      const current = createMetric({ txPoolPending: 5 });

      const anomalies = detectAnomalies(current, history);
      const monotonicAnomaly = anomalies.find(a => a.rule === 'monotonic-increase');

      expect(monotonicAnomaly).toBeUndefined();
    });

    it('should require at least 5 history points for monotonic detection', () => {
      const history = generateHistory(4, { txPoolPending: 10 });
      const current = createMetric({ txPoolPending: 30 });

      const anomalies = detectAnomalies(current, history);
      const monotonicAnomaly = anomalies.find(a => a.rule === 'monotonic-increase');

      expect(monotonicAnomaly).toBeUndefined();
    });
  });

  // ========================================================================
  // Test Suite 6: Integration and Edge Cases
  // ========================================================================

  describe('Anomaly Detection Integration', () => {
    it('should return empty array when no anomalies detected', () => {
      // Generate stable history with cpu around 30
      const history = generateHistory(10, { cpuUsage: 30 });
      // Current values match history baseline (slight variance is OK)
      const current = createMetric({
        cpuUsage: 30.5,
        blockHeight: 5009,
        txPoolPending: 10,
        gasUsedRatio: 0.5,
      });

      const anomalies = detectAnomalies(current, history);

      expect(anomalies).toEqual([]);
    });

    it('should skip detection when history is insufficient (< 5 points)', () => {
      const history = generateHistory(3);
      const current = createMetric({ cpuUsage: 100 }); // Obvious spike

      const anomalies = detectAnomalies(current, history);

      expect(anomalies).toEqual([]);
    });

    it('should detect multiple anomalies in one call', () => {
      // Create history with known stable values
      const now = Date.now();
      const history: MetricDataPoint[] = [];

      // Create history with cpuUsage = 10, 11, 12, ..., 19 (mean=14.5, stdDev≈3)
      for (let i = 0; i < 10; i++) {
        history.push(
          createMetric({
            timestamp: now - (10 - i) * 10 * 1000,
            cpuUsage: 10 + i, // 10, 11, 12, ...
            gasUsedRatio: 0.4 + i * 0.01, // 0.4, 0.41, 0.42, ...
            blockInterval: 2 + i * 0.1, // 2.0, 2.1, 2.2, ...
          })
        );
      }

      // Current has extreme values that should trigger multiple anomalies
      const current = createMetric({
        cpuUsage: 40, // Large spike (Z >> 3.0)
        gasUsedRatio: 1.0, // Large spike
        blockInterval: 5.0, // Large spike
      });

      const anomalies = detectAnomalies(current, history);

      // Should detect multiple anomalies
      expect(anomalies.length).toBeGreaterThanOrEqual(2);
      // At least CPU and one other metric should be detected
      expect(anomalies.some(a => a.metric === 'cpuUsage')).toBe(true);
    });

    it('should not detect same metric twice with different rules', () => {
      const now = Date.now();

      // Create history with high CPU
      const history: MetricDataPoint[] = [];
      for (let i = 0; i < 5; i++) {
        history.push(
          createMetric({
            timestamp: now - (5 - i) * 10 * 1000,
            cpuUsage: 80,
          })
        );
      }

      // Drop to 0 (could match both zero-drop rule and Z-Score drop rule)
      const current = createMetric({ cpuUsage: 0 });

      const anomalies = detectAnomalies(current, history);
      const cpuAnomalies = anomalies.filter(a => a.metric === 'cpuUsage');

      // Should detect only one CPU anomaly (rule priority: zero-drop > others)
      expect(cpuAnomalies.length).toBe(1);
      expect(cpuAnomalies[0].rule).toBe('zero-drop');
    });
  });

  // ========================================================================
  // Test Suite 7: Configuration
  // ========================================================================

  describe('Configuration', () => {
    it('should return detector configuration', () => {
      const config = getDetectorConfig();

      expect(config).toBeDefined();
      expect(config.zScoreThreshold).toBe(3.0);
      expect(config.blockPlateauSeconds).toBe(120);
      expect(config.txPoolMonotonicSeconds).toBe(300);
      expect(config.minHistoryPoints).toBe(5);
    });
  });
});

// ============================================================================
// Constants for Z-Score Threshold (used in tests)
// ============================================================================

const Z_SCORE_THRESHOLD = 3.0;
