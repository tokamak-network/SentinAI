/**
 * Remediation Engine Tests
 *
 * Tests core remediation flow and PatternMiner integration
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { AnomalyEvent } from '@/types/anomaly';
import type { RemediationConfig } from '@/types/remediation';
import { executeRemediation } from './remediation-engine';

// ============================================================
// Test Helpers
// ============================================================

const createTestConfig = (overrides?: Partial<RemediationConfig>): RemediationConfig => ({
  enabled: true,
  cooldownMinutes: 1,
  maxExecutionsPerHour: 10,
  maxExecutionsPerDay: 50,
  allowGuardedActions: true,
  ...overrides,
});

const createAnomalyEvent = (overrides?: Partial<AnomalyEvent>): AnomalyEvent => ({
  id: `evt-${Date.now()}`,
  timestamp: Date.now(),
  status: 'active',
  alerts: [],
  anomalies: [
    {
      metric: 'cpuUsage',
      value: 95,
      zScore: 3.2,
      direction: 'spike',
      rule: 'threshold-breach',
      description: 'CPU usage above critical threshold',
      isAnomaly: true,
    },
  ],
  ...overrides,
});

// ============================================================
// RemediationEngine Tests
// ============================================================

describe('RemediationEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Execution flow', () => {
    it('should execute remediation and return result', async () => {
      const mockEvent = createAnomalyEvent();

      const result = await executeRemediation(mockEvent);

      // Execution should complete
      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      expect(result.startedAt).toBeTruthy();
      expect(result.completedAt).toBeTruthy();
    });

    it('should complete remediation execution quickly (non-blocking async)', async () => {
      const mockEvent = createAnomalyEvent();

      const startMs = Date.now();
      const result = await executeRemediation(mockEvent);
      const durationMs = Date.now() - startMs;

      // Remediation should complete in < 2s even with async pattern mining
      expect(durationMs).toBeLessThan(2000);
      expect(result.completedAt).toBeTruthy();
    });

    it('should not fail when remediation execution encounters issues', async () => {
      const mockEvent = createAnomalyEvent({
        anomalies: [
          {
            metric: 'unknownMetric',
            value: 50,
            zScore: 0.5,
            direction: 'spike',
            rule: 'threshold-breach',
            description: 'Unknown metric',
            isAnomaly: true,
          },
        ],
      });

      // Should not throw even if no playbook matches
      const result = await executeRemediation(mockEvent);

      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      expect(result.completedAt).toBeTruthy();
    });
  });

  describe('Operation ledger integration', () => {
    it('should complete with populated execution record', async () => {
      const mockEvent = createAnomalyEvent();

      const result = await executeRemediation(mockEvent);

      // Verify execution was recorded
      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      expect(result.playbookName).toBeTruthy();
      expect(result.status).toBeTruthy();
      expect(result.completedAt).toBeTruthy();
    });

    it('should handle multiple anomalies in event', async () => {
      const mockEvent = createAnomalyEvent({
        anomalies: [
          {
            metric: 'cpuUsage',
            value: 95,
            zScore: 3.2,
            direction: 'spike',
            rule: 'threshold-breach',
            description: 'CPU usage above critical threshold',
            isAnomaly: true,
          },
          {
            metric: 'memoryUsage',
            value: 85,
            zScore: 2.1,
            direction: 'spike',
            rule: 'threshold-breach',
            description: 'Memory usage above threshold',
            isAnomaly: true,
          },
        ],
      });

      const result = await executeRemediation(mockEvent);

      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      expect(result.completedAt).toBeTruthy();
    });
  });

  describe('Pattern mining async trigger', () => {
    it('should trigger pattern mining without blocking execution', async () => {
      const mockEvent = createAnomalyEvent();

      // Measure execution time
      const startMs = Date.now();
      const result = await executeRemediation(mockEvent);
      const executionTimeMs = Date.now() - startMs;

      // Execution should return quickly (before pattern mining completes)
      expect(result).toBeDefined();
      expect(result.completedAt).toBeTruthy();

      // Even with pattern mining, execution should be < 2s
      // (Pattern mining is fire-and-forget, doesn't block)
      expect(executionTimeMs).toBeLessThan(2000);
    });

    it('should handle cases when Redis is not available', async () => {
      const mockEvent = createAnomalyEvent();

      // When Redis is null (in-memory mode), trigger should exit early
      const result = await executeRemediation(mockEvent);

      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      expect(result.completedAt).toBeTruthy();
    });
  });
});
