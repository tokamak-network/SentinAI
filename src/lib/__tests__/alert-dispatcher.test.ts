/**
 * Unit tests for alert-dispatcher module
 * Tests Slack alert formatting, dispatch logic, and cooldown management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as alertDispatcher from '@/lib/alert-dispatcher';
import type { DeepAnalysisResult, AlertConfig, MetricDataPoint } from '@/types/anomaly';
import type { AnomalyResult } from '@/types/anomaly';

// Mock redis-store
vi.mock('@/lib/redis-store', () => {
  let alertConfig: AlertConfig = {
    enabled: true,
    channels: ['slack'],
    severityFilter: 'medium',
    cooldownMinutes: {
      low: 60,
      medium: 30,
      high: 10,
      critical: 0,
    },
  };

  return {
    getStore: () => ({
      getAlertConfig: async () => alertConfig,
      setAlertConfig: async (config: AlertConfig) => {
        alertConfig = {
          ...alertConfig,
          ...config,
          cooldownMinutes: {
            ...alertConfig.cooldownMinutes,
            ...(config.cooldownMinutes || {}),
          },
        };
      },
      getAlertHistory: async () => [],
      clearAlertHistory: async () => {},
      getLastAlertTime: async () => 0,
      recordAlert: async () => {},
    }),
  };
});

/**
 * Helper: Create deep analysis result
 */
function createAnalysis(
  overrides?: Partial<DeepAnalysisResult>
): DeepAnalysisResult {
  return {
    severity: 'high',
    anomalyType: 'performance',
    correlations: ['CPU spike', 'TxPool growth'],
    predictedImpact: 'Delayed transaction processing',
    suggestedActions: ['Monitor CPU', 'Scale up if needed'],
    relatedComponents: ['op-geth', 'op-node'],
    ...overrides,
  };
}

/**
 * Helper: Create metric
 */
function createMetric(overrides?: Partial<MetricDataPoint>): MetricDataPoint {
  return {
    timestamp: Date.now(),
    cpuUsage: 85,
    blockHeight: 1000,
    blockInterval: 2,
    txPoolPending: 500,
    gasUsedRatio: 0.8,
    currentVcpu: 2,
    ...overrides,
  };
}

/**
 * Helper: Create anomaly
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
    description: 'CPU usage spike',
    rule: 'z-score',
    severity: 'high',
    ...overrides,
  };
}

describe('alert-dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatSlackMessage', () => {
    it('should format Slack message with all required fields', () => {
      const analysis = createAnalysis();
      const metrics = createMetric();
      const anomalies = [createAnomaly()];

      const message = alertDispatcher.formatSlackMessage(
        analysis,
        metrics,
        anomalies
      );

      expect(message).toHaveProperty('blocks');
      expect(Array.isArray(message.blocks)).toBe(true);
      expect(message.blocks.length).toBeGreaterThan(0);
    });

    it('should include severity emoji in message', () => {
      const analysis = createAnalysis({ severity: 'critical' });
      const metrics = createMetric();
      const anomalies = [createAnomaly()];

      const message = alertDispatcher.formatSlackMessage(
        analysis,
        metrics,
        anomalies
      );

      const messageString = JSON.stringify(message);
      expect(messageString).toContain(':red_circle:'); // Critical emoji
    });

    it('should include anomaly type emoji', () => {
      const analysis = createAnalysis({ anomalyType: 'security' });
      const metrics = createMetric();
      const anomalies = [createAnomaly()];

      const message = alertDispatcher.formatSlackMessage(
        analysis,
        metrics,
        anomalies
      );

      const messageString = JSON.stringify(message);
      expect(messageString).toContain(':shield:'); // Security emoji
    });

    it('should include current metrics in context', () => {
      const analysis = createAnalysis();
      const metrics = createMetric({
        cpuUsage: 90,
        txPoolPending: 1000,
        blockHeight: 5000,
      });
      const anomalies = [createAnomaly()];

      const message = alertDispatcher.formatSlackMessage(
        analysis,
        metrics,
        anomalies
      );

      const messageString = JSON.stringify(message);
      expect(messageString).toContain('90');
      expect(messageString).toContain('1000');
      expect(messageString).toContain('5000');
    });

    it('should handle multiple anomalies', () => {
      const analysis = createAnalysis();
      const metrics = createMetric();
      const anomalies = [
        createAnomaly({ metric: 'cpuUsage', description: 'CPU spike' }),
        createAnomaly({ metric: 'txPoolPending', description: 'TxPool growth' }),
        createAnomaly({ metric: 'blockInterval', description: 'Block delay' }),
      ];

      const message = alertDispatcher.formatSlackMessage(
        analysis,
        metrics,
        anomalies
      );

      const messageString = JSON.stringify(message);
      expect(messageString).toContain('CPU spike');
      expect(messageString).toContain('TxPool growth');
      expect(messageString).toContain('Block delay');
    });

    it('should handle empty suggested actions', () => {
      const analysis = createAnalysis({ suggestedActions: [] });
      const metrics = createMetric();
      const anomalies = [createAnomaly()];

      const message = alertDispatcher.formatSlackMessage(
        analysis,
        metrics,
        anomalies
      );

      expect(message).toBeDefined();
      expect(message.blocks).toBeDefined();
    });
  });

  describe('Alert Configuration', () => {
    it('should get default alert configuration', async () => {
      const config = await alertDispatcher.getAlertConfig();

      expect(config.enabled).toBeDefined();
      expect(config.channels).toBeDefined();
      expect(config.severityFilter).toBeDefined();
      expect(config.cooldownMinutes).toBeDefined();
    });

    it('should have valid alert config structure', async () => {
      const config = await alertDispatcher.getAlertConfig();

      // Verify structure
      expect(typeof config.enabled).toBe('boolean');
      expect(Array.isArray(config.channels)).toBe(true);
      expect(['low', 'medium', 'high', 'critical']).toContain(
        config.severityFilter
      );

      // Verify all cooldown levels exist
      expect(config.cooldownMinutes.low).toBeGreaterThan(0);
      expect(config.cooldownMinutes.medium).toBeGreaterThan(0);
      expect(config.cooldownMinutes.high).toBeGreaterThan(0);
      expect(config.cooldownMinutes.critical).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Alert History', () => {
    it('should get alert history', async () => {
      const history = await alertDispatcher.getAlertHistory();

      expect(Array.isArray(history)).toBe(true);
    });

    it('should clear alert history', async () => {
      await alertDispatcher.clearAlertHistory();

      const history = await alertDispatcher.getAlertHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('Cooldown Management', () => {
    it('should check if anomaly type is available', async () => {
      const nextAvailable = await alertDispatcher.getNextAlertAvailableAt(
        'performance'
      );

      // Should return null or a timestamp
      expect(
        nextAvailable === null || typeof nextAvailable === 'number'
      ).toBe(true);
    });

    it('should handle critical severity with 0 cooldown', async () => {
      const config = await alertDispatcher.getAlertConfig();

      expect(config.cooldownMinutes.critical).toBe(0);
    });

    it('should have appropriate cooldown for different severities', async () => {
      const config = await alertDispatcher.getAlertConfig();

      expect(config.cooldownMinutes.low).toBeGreaterThan(
        config.cooldownMinutes.critical
      );
      expect(config.cooldownMinutes.medium).toBeGreaterThan(
        config.cooldownMinutes.critical
      );
      expect(config.cooldownMinutes.high).toBeGreaterThan(
        config.cooldownMinutes.critical
      );
    });
  });

  describe('Integration: Complete Alert Flow', () => {
    it('should format and prepare alert for dispatch', async () => {
      const analysis = createAnalysis({
        severity: 'critical',
        anomalyType: 'consensus',
        correlations: ['L1 reorg detected', 'op-node derivation stalled'],
        predictedImpact: 'Loss of finality, transactions at risk',
        suggestedActions: [
          'Immediately check L1 status',
          'Review op-node logs',
          'Consider failover',
        ],
      });

      const metrics = createMetric({
        cpuUsage: 95,
        txPoolPending: 2000,
        blockHeight: 10000,
      });

      const anomalies = [
        createAnomaly({
          metric: 'blockInterval',
          description: 'Block production stalled',
        }),
        createAnomaly({
          metric: 'cpuUsage',
          description: 'CPU spike during processing',
        }),
      ];

      const message = alertDispatcher.formatSlackMessage(
        analysis,
        metrics,
        anomalies
      );

      // Verify message structure
      expect(message.blocks).toBeDefined();
      expect(message.blocks.length).toBeGreaterThan(0);

      // Verify critical severity
      const messageString = JSON.stringify(message);
      expect(messageString).toContain(':red_circle:');
      expect(messageString).toContain('CRITICAL');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty anomaly list', () => {
      const analysis = createAnalysis();
      const metrics = createMetric();

      const message = alertDispatcher.formatSlackMessage(
        analysis,
        metrics,
        []
      );

      expect(message.blocks).toBeDefined();
    });

    it('should handle empty suggested actions', () => {
      const analysis = createAnalysis({ suggestedActions: [] });
      const metrics = createMetric();
      const anomalies = [createAnomaly()];

      const message = alertDispatcher.formatSlackMessage(
        analysis,
        metrics,
        anomalies
      );

      expect(message).toBeDefined();
    });

    it('should handle empty correlations', () => {
      const analysis = createAnalysis({ correlations: [] });
      const metrics = createMetric();
      const anomalies = [createAnomaly()];

      const message = alertDispatcher.formatSlackMessage(
        analysis,
        metrics,
        anomalies
      );

      const messageString = JSON.stringify(message);
      expect(messageString).toContain('None identified');
    });

    it('should handle very long impact descriptions', () => {
      const longImpact = 'x'.repeat(500);
      const analysis = createAnalysis({ predictedImpact: longImpact });
      const metrics = createMetric();
      const anomalies = [createAnomaly()];

      const message = alertDispatcher.formatSlackMessage(
        analysis,
        metrics,
        anomalies
      );

      expect(message).toBeDefined();
    });
  });
});
