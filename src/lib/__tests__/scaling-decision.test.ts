/**
 * Unit tests for scaling-decision module
 * Tests hybrid scoring, vCPU determination, and confidence calculation
 */

import { describe, it, expect } from 'vitest';
import {
  calculateScalingScore,
  determineTargetVcpu,
  generateReason,
  calculateConfidence,
  makeScalingDecision,
  mapAIResultToSeverity,
} from '@/lib/scaling-decision';
import { ScalingMetrics, DEFAULT_SCALING_CONFIG } from '@/types/scaling';

/**
 * Helper: Create a test metric set
 */
function createMetrics(overrides?: Partial<ScalingMetrics>): ScalingMetrics {
  return {
    cpuUsage: 25,
    gasUsedRatio: 0.4,
    txPoolPending: 50,
    blockHeight: 1000,
    blockInterval: 2,
    aiSeverity: undefined,
    ...overrides,
  };
}

describe('scaling-decision', () => {
  describe('calculateScalingScore', () => {
    it('should calculate score from CPU usage alone', () => {
      const metrics = createMetrics({
        cpuUsage: 50,
        gasUsedRatio: 0,
        txPoolPending: 0,
      });
      const { score, breakdown } = calculateScalingScore(metrics);

      // CPU: 50, Gas: 0, TxPool: 0, AI: 0
      // Score = 50 * 0.3 + 0 + 0 + 0 = 15
      expect(score).toBe(15);
      expect(breakdown.cpuScore).toBe(50);
      expect(breakdown.gasScore).toBe(0);
      expect(breakdown.txPoolScore).toBe(0);
      expect(breakdown.aiScore).toBe(0);
    });

    it('should calculate score from all metrics combined', () => {
      const metrics = createMetrics({
        cpuUsage: 40,
        gasUsedRatio: 0.6,
        txPoolPending: 100,
      });
      const { score, breakdown } = calculateScalingScore(metrics);

      // CPU: 40 (40*0.3=12), Gas: 60 (60*0.3=18), TxPool: 50 (50*0.2=10), AI: 0
      // Score = 12 + 18 + 10 + 0 = 40
      expect(score).toBe(40);
      expect(breakdown.cpuScore).toBe(40);
      expect(breakdown.gasScore).toBe(60);
      expect(breakdown.txPoolScore).toBe(50);
    });

    it('should cap gas usage score at 100', () => {
      const metrics = createMetrics({
        cpuUsage: 0,
        gasUsedRatio: 1.5, // Over 100%
        txPoolPending: 0,
      });
      const { breakdown } = calculateScalingScore(metrics);

      expect(breakdown.gasScore).toBe(100);
    });

    it('should cap txPool score at 100 (200 or more pending)', () => {
      const metrics = createMetrics({
        cpuUsage: 0,
        gasUsedRatio: 0,
        txPoolPending: 500, // Way over threshold
      });
      const { breakdown } = calculateScalingScore(metrics);

      expect(breakdown.txPoolScore).toBe(100);
    });

    it('should include AI severity in score calculation', () => {
      const metrics = createMetrics({
        cpuUsage: 0,
        gasUsedRatio: 0,
        txPoolPending: 0,
        aiSeverity: 'critical', // 100 points
      });
      const { score, breakdown } = calculateScalingScore(metrics);

      // AI: 100 * 0.2 = 20
      expect(breakdown.aiScore).toBe(100);
      expect(score).toBe(20);
    });

    it('should return 0 score when all metrics are zero', () => {
      const metrics = createMetrics({
        cpuUsage: 0,
        gasUsedRatio: 0,
        txPoolPending: 0,
      });
      const { score } = calculateScalingScore(metrics);

      expect(score).toBe(0);
    });

    it('should return maximum score when all metrics are high', () => {
      const metrics = createMetrics({
        cpuUsage: 100,
        gasUsedRatio: 1,
        txPoolPending: 300,
        aiSeverity: 'critical',
      });
      const { score } = calculateScalingScore(metrics);

      // 100*0.3 + 100*0.3 + 100*0.2 + 100*0.2 = 100
      expect(score).toBe(100);
    });

    it('should round score to 2 decimal places', () => {
      const metrics = createMetrics({
        cpuUsage: 33.333,
        gasUsedRatio: 0.333,
        txPoolPending: 33.333,
      });
      const { score } = calculateScalingScore(metrics);

      // Score should be rounded, not contain excessive decimals
      expect(score.toString().split('.')[1]?.length).toBeLessThanOrEqual(2);
    });
  });

  describe('determineTargetVcpu', () => {
    it('should return 1 vCPU for idle score (< 30)', () => {
      const targetVcpu = determineTargetVcpu(20);
      expect(targetVcpu).toBe(1);
    });

    it('should return 2 vCPU for normal score (30-70)', () => {
      expect(determineTargetVcpu(30)).toBe(2);
      expect(determineTargetVcpu(50)).toBe(2);
      expect(determineTargetVcpu(69)).toBe(2);
    });

    it('should return 4 vCPU for high score (70 <= score < 85)', () => {
      expect(determineTargetVcpu(70)).toBe(4);
      expect(determineTargetVcpu(75)).toBe(4);
      expect(determineTargetVcpu(84)).toBe(4);
    });

    it('should return 8 vCPU for critical score (>= 85)', () => {
      expect(determineTargetVcpu(85)).toBe(8);
      expect(determineTargetVcpu(90)).toBe(8);
      expect(determineTargetVcpu(100)).toBe(8);
    });

    it('should handle boundary: score exactly 30 → 2 vCPU', () => {
      expect(determineTargetVcpu(30)).toBe(2);
    });

    it('should handle boundary: score exactly 70 → 4 vCPU', () => {
      expect(determineTargetVcpu(70)).toBe(4);
    });

    it('should handle boundary: score exactly 85 → 8 vCPU', () => {
      expect(determineTargetVcpu(85)).toBe(8);
    });

    it('should handle zero score → 1 vCPU', () => {
      expect(determineTargetVcpu(0)).toBe(1);
    });
  });

  describe('generateReason', () => {
    it('should generate idle reason when targeting 1 vCPU', () => {
      const metrics = createMetrics({ cpuUsage: 10 });
      const breakdown = { cpuScore: 10, gasScore: 0, txPoolScore: 5, aiScore: 0 };

      const reason = generateReason(10, 1, breakdown, metrics);

      expect(reason).toContain('System Idle');
      expect(reason).toContain('CPU 10.0% Low');
      expect(reason).toContain('Low TxPool Pending');
    });

    it('should generate normal load reason when targeting 2 vCPU', () => {
      const metrics = createMetrics({ cpuUsage: 40, gasUsedRatio: 0.5 });
      const breakdown = { cpuScore: 40, gasScore: 50, txPoolScore: 25, aiScore: 0 };

      const reason = generateReason(45, 2, breakdown, metrics);

      expect(reason).toContain('Normal Load Detected');
      expect(reason).toContain('CPU 40.0%');
      expect(reason).toContain('Gas Usage 50.0%');
    });

    it('should generate high load reason when targeting 4 vCPU', () => {
      const metrics = createMetrics({
        cpuUsage: 80,
        txPoolPending: 250,
      });
      const breakdown = { cpuScore: 80, gasScore: 30, txPoolScore: 100, aiScore: 100 };

      const reason = generateReason(85, 4, breakdown, metrics);

      expect(reason).toContain('High Load Detected');
      expect(reason).toContain('CPU 80.0% High');
      expect(reason).toContain('TxPool 250 Pending');
      expect(reason).toContain('AI Warning: High Severity');
    });

    it('should include score in reason', () => {
      const metrics = createMetrics();
      const breakdown = { cpuScore: 30, gasScore: 30, txPoolScore: 25, aiScore: 0 };

      const reason = generateReason(42.5, 2, breakdown, metrics);

      expect(reason).toContain('Score: 42.5');
    });
  });

  describe('calculateConfidence', () => {
    it('should return base confidence of 0.7', () => {
      const metrics = createMetrics({
        cpuUsage: -50, // Invalid
        aiSeverity: undefined,
        txPoolPending: -10, // Invalid
      });

      const confidence = calculateConfidence(metrics);

      expect(confidence).toBe(0.7);
    });

    it('should add 0.1 for valid CPU usage', () => {
      const metrics = createMetrics({
        cpuUsage: 50,
        aiSeverity: undefined,
        txPoolPending: -1, // Invalid
      });

      const confidence = calculateConfidence(metrics);

      expect(confidence).toBeCloseTo(0.8, 2); // 0.7 + 0.1
    });

    it('should add 0.15 for AI severity', () => {
      const metrics = createMetrics({
        cpuUsage: -1, // Invalid
        aiSeverity: 'high',
        txPoolPending: -1, // Invalid
      });

      const confidence = calculateConfidence(metrics);

      expect(confidence).toBe(0.85); // 0.7 + 0.15
    });

    it('should add 0.05 for positive txPoolPending', () => {
      const metrics = createMetrics({
        cpuUsage: -1, // Invalid
        aiSeverity: undefined,
        txPoolPending: 100,
      });

      const confidence = calculateConfidence(metrics);

      expect(confidence).toBe(0.75); // 0.7 + 0.05
    });

    it('should combine all bonuses up to 1.0 max', () => {
      const metrics = createMetrics({
        cpuUsage: 50,
        aiSeverity: 'critical',
        txPoolPending: 100,
      });

      const confidence = calculateConfidence(metrics);

      // 0.7 + 0.1 + 0.15 + 0.05 = 1.0 (capped)
      expect(confidence).toBe(1);
    });

    it('should handle edge case: CPU exactly 0 and 100', () => {
      const isolated0 = createMetrics({
        cpuUsage: 0,
        aiSeverity: undefined,
        txPoolPending: -1,
      });
      const isolated100 = createMetrics({
        cpuUsage: 100,
        aiSeverity: undefined,
        txPoolPending: -1,
      });
      expect(calculateConfidence(isolated0)).toBeCloseTo(0.8, 2);
      expect(calculateConfidence(isolated100)).toBeCloseTo(0.8, 2);
    });
  });

  describe('mapAIResultToSeverity', () => {
    it('should map "normal" to "low"', () => {
      const result = mapAIResultToSeverity({ severity: 'normal' });
      expect(result).toBe('low');
    });

    it('should map "warning" to "medium"', () => {
      const result = mapAIResultToSeverity({ severity: 'warning' });
      expect(result).toBe('medium');
    });

    it('should map "critical" to "critical"', () => {
      const result = mapAIResultToSeverity({ severity: 'critical' });
      expect(result).toBe('critical');
    });

    it('should map "high" directly', () => {
      const result = mapAIResultToSeverity({ severity: 'high' });
      expect(result).toBe('high');
    });

    it('should be case-insensitive', () => {
      expect(mapAIResultToSeverity({ severity: 'CRITICAL' })).toBe('critical');
      expect(mapAIResultToSeverity({ severity: 'Warning' })).toBe('medium');
    });

    it('should return undefined for null/empty result', () => {
      expect(mapAIResultToSeverity(null)).toBeUndefined();
      expect(mapAIResultToSeverity({})).toBeUndefined();
    });

    it('should default to "medium" for unknown severity', () => {
      const result = mapAIResultToSeverity({ severity: 'unknown' });
      expect(result).toBe('medium');
    });
  });

  describe('makeScalingDecision (integration)', () => {
    it('should make idle decision (1 vCPU)', () => {
      const metrics = createMetrics({
        cpuUsage: 15,
        gasUsedRatio: 0.2,
        txPoolPending: 20,
      });

      const decision = makeScalingDecision(metrics);

      expect(decision.targetVcpu).toBe(1);
      expect(decision.targetMemoryGiB).toBe(2);
      expect(decision.confidence).toBeGreaterThan(0.7);
      expect(decision.reason).toContain('System Idle');
    });

    it('should make normal decision (2 vCPU)', () => {
      const metrics = createMetrics({
        cpuUsage: 45,
        gasUsedRatio: 0.5,
        txPoolPending: 80,
      });

      const decision = makeScalingDecision(metrics);

      expect(decision.targetVcpu).toBe(2);
      expect(decision.targetMemoryGiB).toBe(4);
      expect(decision.reason).toContain('Normal Load Detected');
    });

    it('should make high load decision (4 vCPU)', () => {
      const metrics = createMetrics({
        cpuUsage: 85,
        gasUsedRatio: 0.8,
        txPoolPending: 250,
        aiSeverity: 'high',
      });

      const decision = makeScalingDecision(metrics);

      expect(decision.targetVcpu).toBe(4);
      expect(decision.targetMemoryGiB).toBe(8);
      expect(decision.confidence).toBe(1); // Maximum confidence
      expect(decision.reason).toContain('High Load Detected');
    });

    it('should calculate memory correctly (2 * vCPU GiB)', () => {
      const metrics1 = createMetrics({
        cpuUsage: 10,
        gasUsedRatio: 0,
        txPoolPending: 0,
      }); // Score: 3 → 1 vCPU
      const metrics2 = createMetrics({
        cpuUsage: 50,
        gasUsedRatio: 0.4,
        txPoolPending: 50,
      }); // Score: ~27 → 2 vCPU
      const metrics4 = createMetrics({
        cpuUsage: 100,
        gasUsedRatio: 1,
        txPoolPending: 300,
      }); // Score: 100 → 4 vCPU

      expect(makeScalingDecision(metrics1).targetMemoryGiB).toBe(2);
      expect(makeScalingDecision(metrics2).targetMemoryGiB).toBe(4);
      expect(makeScalingDecision(metrics4).targetMemoryGiB).toBe(8);
    });

    it('should use custom config when provided', () => {
      const customConfig = {
        ...DEFAULT_SCALING_CONFIG,
        thresholds: {
          idle: 50, // Changed from 30
          normal: 80, // Changed from 70
        },
        weights: { ...DEFAULT_SCALING_CONFIG.weights },
      };

      const metrics = createMetrics({ cpuUsage: 40 }); // Score ≈ 12
      const decision = makeScalingDecision(metrics, customConfig);

      // With custom thresholds, score 12 < 50 → 1 vCPU
      expect(decision.targetVcpu).toBe(1);
    });
  });
});
