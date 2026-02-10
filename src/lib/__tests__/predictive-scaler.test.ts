/**
 * Unit tests for predictive-scaler module
 * Tests AI-powered scaling predictions, rate limiting, and fallback logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as predictiveScaler from '@/lib/predictive-scaler';
import { PredictionResult, MetricDataPoint } from '@/types/prediction';
import { TargetVcpu } from '@/types/scaling';

// Mock dependencies
vi.mock('@/lib/ai-client', () => ({
  chatCompletion: vi.fn(),
}));

vi.mock('@/lib/ai-response-parser', () => ({
  parseAIJSON: (content: string) => JSON.parse(content),
}));

vi.mock('@/lib/metrics-store', () => ({
  getRecentMetrics: vi.fn(),
  getMetricsStats: vi.fn(),
  getMetricsCount: vi.fn(),
}));

vi.mock('@/lib/redis-store', () => {
  const predictionState = {
    lastPrediction: null as PredictionResult | null,
    lastPredictionTime: 0,
  };

  return {
    getStore: () => ({
      getLastPredictionTime: async () => predictionState.lastPredictionTime,
      getLastPrediction: async () => predictionState.lastPrediction,
      setLastPredictionTime: async (time: number) => {
        predictionState.lastPredictionTime = time;
      },
      setLastPrediction: async (pred: PredictionResult) => {
        predictionState.lastPrediction = pred;
      },
      resetPredictionState: async () => {
        predictionState.lastPrediction = null;
        predictionState.lastPredictionTime = 0;
      },
    }),
  };
});

const { chatCompletion } = await import('@/lib/ai-client');
const { getRecentMetrics, getMetricsStats, getMetricsCount } = await import(
  '@/lib/metrics-store'
);

/**
 * Helper: Create mock metrics stats
 */
function createMockStats(
  cpuOverride?: Partial<any>,
  otherOverrides?: any
) {
  return {
    count: 30,
    oldestTimestamp: Date.now() - 30 * 60000,
    newestTimestamp: Date.now(),
    stats: {
      cpu: {
        mean: 35,
        stdDev: 5,
        min: 20,
        max: 50,
        trend: 'stable' as const,
        slope: 0.1,
        ...cpuOverride,
      },
      txPool: {
        mean: 80,
        stdDev: 20,
        min: 50,
        max: 150,
        trend: 'stable' as const,
        slope: 0.05,
      },
      gasUsedRatio: {
        mean: 0.45,
        stdDev: 0.1,
        min: 0.2,
        max: 0.7,
        trend: 'stable' as const,
        slope: 0,
      },
      blockInterval: {
        mean: 2.0,
        stdDev: 0.1,
        min: 1.8,
        max: 2.3,
        trend: 'stable' as const,
        slope: 0,
      },
    },
    ...otherOverrides,
  };
}

/**
 * Helper: Create valid AI response
 */
function createValidAIResponse(overrides?: Partial<PredictionResult>) {
  return JSON.stringify({
    predictedVcpu: 2,
    confidence: 0.75,
    trend: 'stable',
    reasoning: 'CPU trending stable at 35%, recommend maintaining 2 vCPU.',
    recommendedAction: 'maintain',
    factors: [
      { name: 'cpuUsage', impact: 0.3, description: 'CPU 35% is moderate' },
      { name: 'txPool', impact: 0.2, description: 'TxPool 80 pending' },
    ],
    ...overrides,
  });
}

describe('predictive-scaler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await predictiveScaler.resetPredictionState();

    // Setup default mocks
    vi.mocked(getMetricsCount).mockResolvedValue(30);
    vi.mocked(getRecentMetrics).mockResolvedValue([]);
    vi.mocked(getMetricsStats).mockResolvedValue(createMockStats());
  });

  describe('Rate limiting', () => {
    it('should allow prediction when cooldown has elapsed', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: createValidAIResponse(),
        stopReason: 'end_turn',
      });

      const result = await predictiveScaler.predictScaling(2);
      expect(result).not.toBeNull();
      expect(result?.predictedVcpu).toBe(2);
    });

    it('should return cached prediction when within cooldown', async () => {
      const cached: PredictionResult = {
        predictedVcpu: 4,
        confidence: 0.8,
        trend: 'rising',
        reasoning: 'Cached prediction',
        recommendedAction: 'scale_up',
        generatedAt: new Date().toISOString(),
        predictionWindow: 'next 5 minutes',
        factors: [],
      };

      vi.mocked(chatCompletion).mockResolvedValue({
        content: createValidAIResponse(),
        stopReason: 'end_turn',
      });

      // First prediction
      const first = await predictiveScaler.predictScaling(2);
      expect(first?.predictedVcpu).toBe(2);

      // Within cooldown, should return cached
      const second = await predictiveScaler.predictScaling(2);
      expect(second).toEqual(first);
      // Should only call AI once
      expect(chatCompletion).toHaveBeenCalledTimes(1);
    });

    it('should check prediction availability status', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: createValidAIResponse(),
        stopReason: 'end_turn',
      });

      // Before any prediction
      let canPredict = await predictiveScaler.canMakePrediction();
      expect(canPredict).toBe(true);

      // Make first prediction
      await predictiveScaler.predictScaling(2);

      // Immediately after, should be in cooldown
      canPredict = await predictiveScaler.canMakePrediction();
      expect(canPredict).toBe(false);
    });

    it('should report time until next prediction', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: createValidAIResponse(),
        stopReason: 'end_turn',
      });

      await predictiveScaler.predictScaling(2);

      const timeLeft = await predictiveScaler.getNextPredictionIn();
      expect(timeLeft).toBeGreaterThan(0);
      expect(timeLeft).toBeLessThanOrEqual(300); // Default cooldown
    });
  });

  describe('Minimum data points', () => {
    it('should return null when insufficient data', async () => {
      vi.mocked(getMetricsCount).mockResolvedValue(5); // Below default minimum of 10

      const result = await predictiveScaler.predictScaling(2);
      expect(result).toBeNull();
      // Should not call AI if data is insufficient
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('should allow prediction at minimum threshold', async () => {
      vi.mocked(getMetricsCount).mockResolvedValue(10); // Exactly minimum
      vi.mocked(chatCompletion).mockResolvedValue({
        content: createValidAIResponse(),
        stopReason: 'end_turn',
      });

      const result = await predictiveScaler.predictScaling(2);
      expect(result).not.toBeNull();
    });
  });

  describe('AI response parsing', () => {
    it('should parse valid AI response', async () => {
      const response = {
        predictedVcpu: 4,
        confidence: 0.85,
        trend: 'rising',
        reasoning: 'High CPU trend detected',
        recommendedAction: 'scale_up',
        factors: [
          { name: 'cpuTrend', impact: 0.8, description: 'CPU rising fast' },
        ],
      };

      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify(response),
        stopReason: 'end_turn',
      });

      const result = await predictiveScaler.predictScaling(2);
      expect(result?.predictedVcpu).toBe(4);
      expect(result?.confidence).toBe(0.85);
      expect(result?.trend).toBe('rising');
      expect(result?.recommendedAction).toBe('scale_up');
    });

    it('should validate vCPU values (1, 2, or 4 only)', async () => {
      // Invalid vCPU will trigger fallback
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify({
          predictedVcpu: 3, // Invalid
          confidence: 0.7,
          trend: 'stable',
          reasoning: 'Test',
          recommendedAction: 'maintain',
          factors: [],
        }),
        stopReason: 'end_turn',
      });

      const result = await predictiveScaler.predictScaling(2);
      // Should fallback to rule-based prediction
      expect(result?.confidence).toBeLessThanOrEqual(0.5);
    });

    it('should validate confidence range (0-1)', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify({
          predictedVcpu: 2,
          confidence: 1.5, // Invalid (> 1)
          trend: 'stable',
          reasoning: 'Test',
          recommendedAction: 'maintain',
          factors: [],
        }),
        stopReason: 'end_turn',
      });

      const result = await predictiveScaler.predictScaling(2);
      expect(result?.confidence).toBeLessThanOrEqual(0.5); // Fallback
    });

    it('should handle missing factors array', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify({
          predictedVcpu: 2,
          confidence: 0.7,
          trend: 'stable',
          reasoning: 'Test reasoning',
          recommendedAction: 'maintain',
          // No factors field
        }),
        stopReason: 'end_turn',
      });

      const result = await predictiveScaler.predictScaling(2);
      expect(result?.factors).toEqual([]);
    });
  });

  describe('Fallback prediction', () => {
    it('should fallback when AI call fails', async () => {
      vi.mocked(chatCompletion).mockRejectedValue(new Error('AI provider error'));
      vi.mocked(getMetricsStats).mockResolvedValue(
        createMockStats(
          {
            mean: 35,
            stdDev: 5,
            min: 20,
            max: 50,
            trend: 'stable',
            slope: 0.1,
          }
        )
      );

      const result = await predictiveScaler.predictScaling(2);
      expect(result).not.toBeNull();
      expect(result?.confidence).toBeLessThanOrEqual(0.5); // Low confidence fallback
      expect(result?.recommendedAction).toBe('maintain');
    });

    it('should scale up when CPU is rising and high', async () => {
      vi.mocked(chatCompletion).mockRejectedValue(new Error('AI error'));
      vi.mocked(getMetricsStats).mockResolvedValue(
        createMockStats(
          {
            mean: 60, // High
            stdDev: 5,
            min: 50,
            max: 70,
            trend: 'rising',
            slope: 2.0,
          }
        )
      );

      const result = await predictiveScaler.predictScaling(1); // Currently 1 vCPU
      expect(result?.recommendedAction).toBe('scale_up');
      expect(result?.predictedVcpu).toBeGreaterThan(1);
    });

    it('should scale down when CPU is falling and low', async () => {
      vi.mocked(chatCompletion).mockRejectedValue(new Error('AI error'));
      vi.mocked(getMetricsStats).mockResolvedValue(
        createMockStats(
          {
            mean: 20, // Low
            stdDev: 5,
            min: 10,
            max: 30,
            trend: 'falling',
            slope: -2.0,
          }
        )
      );

      const result = await predictiveScaler.predictScaling(4); // Currently 4 vCPU
      expect(result?.recommendedAction).toBe('scale_down');
      expect(result?.predictedVcpu).toBeLessThan(4);
    });
  });

  describe('vCPU tier navigation', () => {
    it('should navigate up vCPU tiers correctly', async () => {
      vi.mocked(chatCompletion).mockRejectedValue(new Error('AI error'));
      vi.mocked(getMetricsStats).mockResolvedValue(
        createMockStats(
          {
            mean: 70,
            stdDev: 5,
            min: 60,
            max: 80,
            trend: 'rising',
            slope: 3.0,
          }
        )
      );

      // From 1 → should go to 2
      let result = await predictiveScaler.predictScaling(1);
      expect(result?.predictedVcpu).toBe(2);

      // Reset state
      await predictiveScaler.resetPredictionState();

      // From 2 → should go to 4
      result = await predictiveScaler.predictScaling(2);
      expect(result?.predictedVcpu).toBe(4);
    });

    it('should cap vCPU at 4 when scaling up', async () => {
      vi.mocked(chatCompletion).mockRejectedValue(new Error('AI error'));
      vi.mocked(getMetricsStats).mockResolvedValue(
        createMockStats(
          {
            mean: 90,
            stdDev: 5,
            min: 80,
            max: 100,
            trend: 'rising',
            slope: 5.0,
          }
        )
      );

      // From 4 → should stay at 4 (can't go higher)
      const result = await predictiveScaler.predictScaling(4);
      expect(result?.predictedVcpu).toBeLessThanOrEqual(4);
    });
  });

  describe('Cached prediction retrieval', () => {
    it('should get last prediction without new request', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: createValidAIResponse(),
        stopReason: 'end_turn',
      });

      // Make first prediction
      const first = await predictiveScaler.predictScaling(2);
      expect(first).not.toBeNull();

      // Get last prediction without triggering new request
      const cached = await predictiveScaler.getLastPrediction();
      expect(cached).toEqual(first);
    });

    it('should return null when no prediction exists', async () => {
      const result = await predictiveScaler.getLastPrediction();
      expect(result).toBeNull();
    });
  });

  describe('State reset', () => {
    it('should reset prediction state completely', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: createValidAIResponse(),
        stopReason: 'end_turn',
      });

      // Make prediction
      const first = await predictiveScaler.predictScaling(2);
      expect(first).not.toBeNull();

      // Reset state
      await predictiveScaler.resetPredictionState();

      // Should be able to make new prediction immediately (cooldown reset)
      const canPredict = await predictiveScaler.canMakePrediction();
      expect(canPredict).toBe(true);

      // Last prediction should be cleared
      const cached = await predictiveScaler.getLastPrediction();
      expect(cached).toBeNull();
    });
  });

  describe('Integration: Full prediction flow', () => {
    it('should make complete prediction with AI success', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: createValidAIResponse({
          predictedVcpu: 3,
          confidence: 0.82,
          trend: 'rising',
          recommendedAction: 'scale_up',
          factors: [
            { name: 'cpuTrend', impact: 0.7, description: 'Rising CPU' },
            { name: 'txPoolLoad', impact: 0.6, description: 'High TxPool' },
          ],
        }),
        stopReason: 'end_turn',
      });

      const result = await predictiveScaler.predictScaling(2);

      expect(result).not.toBeNull();
      expect(result?.predictedVcpu).toBeGreaterThanOrEqual(1);
      expect(result?.predictedVcpu).toBeLessThanOrEqual(4);
      expect(result?.confidence).toBeGreaterThan(0);
      expect(result?.confidence).toBeLessThanOrEqual(1);
      expect(result?.generatedAt).toBeTruthy();
      expect(result?.predictionWindow).toBe('next 5 minutes');
    });

    it('should gracefully handle all failure scenarios', async () => {
      // AI provider down
      vi.mocked(chatCompletion).mockRejectedValue(
        new Error('Connection refused')
      );

      const result = await predictiveScaler.predictScaling(2);

      // Should still return a prediction (fallback)
      expect(result).not.toBeNull();
      expect(result?.reasoning).toContain('Fallback');
      expect(result?.confidence).toBeLessThanOrEqual(0.5);
    });
  });
});
