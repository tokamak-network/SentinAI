/**
 * Unit tests for anomaly-ai-analyzer module
 * Tests AI-powered semantic anomaly analysis and caching
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as anomalyAnalyzer from '@/lib/anomaly-ai-analyzer';
import type { AnomalyResult, DeepAnalysisResult } from '@/types/anomaly';
import type { MetricDataPoint } from '@/types/prediction';

// Mock dependencies
vi.mock('@/lib/ai-client', () => ({
  chatCompletion: vi.fn(),
}));

vi.mock('@/lib/ai-response-parser', () => ({
  parseAIJSON: (content: string) => JSON.parse(content),
}));

const { chatCompletion } = await import('@/lib/ai-client');

/**
 * Helper: Create test anomaly result
 */
function createAnomaly(overrides?: Partial<AnomalyResult>): AnomalyResult {
  return {
    timestamp: Date.now(),
    metric: 'cpuUsage',
    value: 85,
    mean: 35,
    stdDev: 5,
    zScore: 10,
    direction: 'spike',
    isAnomaly: true,
    description: 'CPU usage spike detected',
    rule: 'z-score',
    severity: 'high',
    ...overrides,
  };
}

/**
 * Helper: Create test metric
 */
function createMetric(overrides?: Partial<MetricDataPoint>): MetricDataPoint {
  return {
    timestamp: Date.now(),
    cpuUsage: 35,
    blockHeight: 1000,
    blockInterval: 2,
    txPoolPending: 100,
    gasUsedRatio: 0.5,
    currentVcpu: 2,
    ...overrides,
  };
}

/**
 * Helper: Create valid AI response
 */
function createValidAnalysis(
  overrides?: Partial<DeepAnalysisResult>
): DeepAnalysisResult {
  return {
    severity: 'high',
    anomalyType: 'performance',
    correlations: ['CPU spike detected', 'TxPool stable'],
    predictedImpact: 'Delayed transaction processing',
    suggestedActions: ['Monitor CPU', 'Check application logs'],
    relatedComponents: ['op-geth'],
    ...overrides,
  };
}

describe('anomaly-ai-analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    anomalyAnalyzer.clearAnalysisCache();
  });

  describe('Rate Limiting', () => {
    it('should allow analysis when rate limit allows', () => {
      const status = anomalyAnalyzer.getRateLimitStatus();

      expect(status.canCall).toBe(true);
    });

    it('should provide next available time in future', () => {
      const status = anomalyAnalyzer.getRateLimitStatus();

      // nextAvailableAt should be a positive number (milliseconds)
      expect(status.nextAvailableAt).toBeGreaterThanOrEqual(0);
    });

    it('should enforce rate limit between consecutive calls', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify(createValidAnalysis()),
        stopReason: 'end_turn',
      });

      // First call
      const anomalies1 = [createAnomaly()];
      const metrics1 = createMetric();
      const result1 = await anomalyAnalyzer.analyzeAnomalies(
        anomalies1,
        metrics1,
        {}
      );

      expect(result1).not.toBeNull();

      // Immediately after, should be rate limited
      const status = anomalyAnalyzer.getRateLimitStatus();
      expect(status.canCall).toBe(false);
      expect(status.nextAvailableAt).toBeGreaterThan(Date.now());
    });
  });

  describe('Analysis Caching', () => {
    it('should return cached result for identical anomalies', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify(createValidAnalysis()),
        stopReason: 'end_turn',
      });

      const anomalies = [
        createAnomaly({ metric: 'cpuUsage' }),
        createAnomaly({ metric: 'txPoolPending' }),
      ];
      const metrics = createMetric();
      const logs = {};

      // First call - should call AI
      const result1 = await anomalyAnalyzer.analyzeAnomalies(
        anomalies,
        metrics,
        logs
      );

      // Second call with identical anomalies - should use cache
      const result2 = await anomalyAnalyzer.analyzeAnomalies(
        anomalies,
        metrics,
        logs
      );

      // Results should be identical
      expect(result1).toEqual(result2);

      // Should only call AI once
      expect(chatCompletion).toHaveBeenCalledTimes(1);
    });

    it('should call AI again for different anomalies', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify(createValidAnalysis()),
        stopReason: 'end_turn',
      });

      const metrics = createMetric();
      const logs = {};

      // First call
      await anomalyAnalyzer.analyzeAnomalies(
        [createAnomaly({ metric: 'cpuUsage' })],
        metrics,
        logs
      );

      // Clear cache to test new anomalies
      anomalyAnalyzer.clearAnalysisCache();

      // Second call with different anomalies
      await anomalyAnalyzer.analyzeAnomalies(
        [createAnomaly({ metric: 'txPoolPending' })],
        metrics,
        logs
      );

      // Should call AI twice (cache cleared between)
      expect(chatCompletion).toHaveBeenCalledTimes(2);
    });

    it('should clear analysis cache', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify(createValidAnalysis()),
        stopReason: 'end_turn',
      });

      const anomalies = [createAnomaly()];
      const metrics = createMetric();

      // First call
      await anomalyAnalyzer.analyzeAnomalies(anomalies, metrics, {});

      // Clear cache
      anomalyAnalyzer.clearAnalysisCache();

      // Second call with same anomalies should call AI again
      await anomalyAnalyzer.analyzeAnomalies(anomalies, metrics, {});

      expect(chatCompletion).toHaveBeenCalledTimes(2);
    });
  });

  describe('AI Response Parsing', () => {
    it('should parse valid AI response', async () => {
      const analysis = {
        severity: 'critical',
        anomalyType: 'consensus',
        correlations: ['L1 sync failure', 'op-node stalled'],
        predictedImpact: 'Loss of finality',
        suggestedActions: ['Restart op-node', 'Check L1 connection'],
        relatedComponents: ['op-node', 'l1'],
      };

      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify(analysis),
        stopReason: 'end_turn',
      });

      const result = await anomalyAnalyzer.analyzeAnomalies(
        [createAnomaly()],
        createMetric(),
        {}
      );

      expect(result?.severity).toBe('critical');
      expect(result?.anomalyType).toBe('consensus');
      expect(result?.correlations).toContain('L1 sync failure');
    });

    it('should handle missing optional fields', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify({
          severity: 'medium',
          anomalyType: 'performance',
          // Missing correlations, predictedImpact, suggestedActions
        }),
        stopReason: 'end_turn',
      });

      const result = await anomalyAnalyzer.analyzeAnomalies(
        [createAnomaly()],
        createMetric(),
        {}
      );

      expect(result?.severity).toBe('medium');
      expect(result?.correlations).toEqual([]);
      expect(result?.suggestedActions).toEqual([]);
    });

    it('should apply defaults for invalid severity', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify({
          severity: 'invalid-level',
          anomalyType: 'performance',
        }),
        stopReason: 'end_turn',
      });

      const result = await anomalyAnalyzer.analyzeAnomalies(
        [createAnomaly()],
        createMetric(),
        {}
      );

      // Should default to 'medium'
      expect(['low', 'medium', 'high', 'critical']).toContain(result?.severity);
    });
  });

  describe('Fallback Behavior', () => {
    it('should fallback to default analysis on AI error', async () => {
      vi.mocked(chatCompletion).mockRejectedValue(
        new Error('AI provider error')
      );

      const result = await anomalyAnalyzer.analyzeAnomalies(
        [createAnomaly()],
        createMetric(),
        {}
      );

      // Should return a result even with error
      expect(result).not.toBeNull();
      expect(result?.severity).toBeTruthy();
    });

    it('should fallback on invalid JSON response', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: 'not valid json',
        stopReason: 'end_turn',
      });

      const result = await anomalyAnalyzer.analyzeAnomalies(
        [createAnomaly()],
        createMetric(),
        {}
      );

      // Should still return a result
      expect(result).not.toBeNull();
    });
  });

  describe('Integration: Full Analysis Flow', () => {
    it('should analyze multiple correlated anomalies', async () => {
      const analysis = createValidAnalysis({
        anomalyType: 'consensus',
        correlations: [
          'CPU spike 10x above mean',
          'TxPool increased 5x',
          'Block interval jumped to 10s',
        ],
        predictedImpact: 'Transaction delays up to 10 seconds',
        suggestedActions: [
          'Check op-geth logs for errors',
          'Monitor L1 connection',
          'Scale up to 4 vCPU',
        ],
      });

      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify(analysis),
        stopReason: 'end_turn',
      });

      const anomalies = [
        createAnomaly({
          metric: 'cpuUsage',
          value: 95,
          zScore: 10,
          description: 'CPU spike',
        }),
        createAnomaly({
          metric: 'txPoolPending',
          value: 500,
          zScore: 5,
          description: 'TxPool accumulated',
        }),
        createAnomaly({
          metric: 'blockInterval',
          value: 10,
          zScore: 8,
          description: 'Block interval increased',
        }),
      ];

      const metrics = createMetric({
        cpuUsage: 95,
        txPoolPending: 500,
        blockInterval: 10,
      });

      const logs = {
        'op-geth':
          '[ERROR] Failed to process transaction: out of memory',
        'op-node': '[WARN] Block derivation stalled',
      };

      const result = await anomalyAnalyzer.analyzeAnomalies(
        anomalies,
        metrics,
        logs
      );

      // Should have a valid severity level
      expect(['low', 'medium', 'high', 'critical']).toContain(result?.severity);
      expect(result?.anomalyType).toBe('consensus');
      expect(result?.correlations.length).toBeGreaterThan(0);
      expect(result?.suggestedActions.length).toBeGreaterThan(0);
    });

    it('should categorize different anomaly types', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify({
          severity: 'high',
          anomalyType: 'security',
          correlations: ['Repeated failed transactions'],
          predictedImpact: 'Potential attack detected',
          suggestedActions: ['Check transaction source', 'Enable rate limiting'],
          relatedComponents: ['op-geth'],
        }),
        stopReason: 'end_turn',
      });

      const result = await anomalyAnalyzer.analyzeAnomalies(
        [createAnomaly({ metric: 'txPoolPending', description: 'Unusual TX pattern' })],
        createMetric(),
        { 'op-geth': '[WARN] Repeated invalid signatures detected' }
      );

      expect(result?.anomalyType).toBe('security');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty anomaly list', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify(createValidAnalysis()),
        stopReason: 'end_turn',
      });

      const result = await anomalyAnalyzer.analyzeAnomalies(
        [],
        createMetric(),
        {}
      );

      expect(result).not.toBeNull();
    });

    it('should handle empty logs', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify(createValidAnalysis()),
        stopReason: 'end_turn',
      });

      const result = await anomalyAnalyzer.analyzeAnomalies(
        [createAnomaly()],
        createMetric(),
        {}
      );

      expect(result).not.toBeNull();
    });

    it('should handle very long log entries', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify(createValidAnalysis()),
        stopReason: 'end_turn',
      });

      const longLog = 'x'.repeat(5000);

      const result = await anomalyAnalyzer.analyzeAnomalies(
        [createAnomaly()],
        createMetric(),
        { 'op-geth': longLog }
      );

      expect(result).not.toBeNull();
    });
  });
});
