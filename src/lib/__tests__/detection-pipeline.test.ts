/**
 * Detection Pipeline Tests
 * Tests the extracted anomaly detection pipeline (Layer 1-4)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/metrics-store', () => ({
  getRecentMetrics: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/anomaly-detector', () => ({
  detectAnomalies: vi.fn().mockReturnValue([]),
}));

vi.mock('@/lib/anomaly-ai-analyzer', () => ({
  analyzeAnomalies: vi.fn().mockResolvedValue({
    severity: 'medium',
    anomalyType: 'performance',
    correlations: [],
    predictedImpact: 'Test impact',
    suggestedActions: ['Test action'],
    relatedComponents: [],
    timestamp: new Date().toISOString(),
  }),
}));

vi.mock('@/lib/alert-dispatcher', () => ({
  dispatchAlert: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/anomaly-event-store', () => ({
  createOrUpdateEvent: vi.fn().mockResolvedValue({
    id: 'test-event-1',
    timestamp: Date.now(),
    anomalies: [],
    status: 'active',
    alerts: [],
    deepAnalysis: undefined,
  }),
  addDeepAnalysis: vi.fn().mockResolvedValue(undefined),
  addAlertRecord: vi.fn().mockResolvedValue(undefined),
  resolveActiveEventIfExists: vi.fn().mockResolvedValue(undefined),
  getActiveEventId: vi.fn().mockResolvedValue(null),
  getEventById: vi.fn().mockResolvedValue({
    id: 'test-event-1',
    timestamp: Date.now(),
    anomalies: [],
    status: 'active',
    alerts: [],
  }),
}));

vi.mock('@/lib/log-ingester', () => ({
  getAllLiveLogs: vi.fn().mockResolvedValue('mock log data'),
}));

vi.mock('@/lib/remediation-engine', () => ({
  executeRemediation: vi.fn().mockResolvedValue(undefined),
}));

import { runDetectionPipeline } from '@/lib/detection-pipeline';
import { detectAnomalies } from '@/lib/anomaly-detector';
import { createOrUpdateEvent, resolveActiveEventIfExists, getActiveEventId } from '@/lib/anomaly-event-store';
import type { MetricDataPoint } from '@/types/prediction';

const mockDataPoint: MetricDataPoint = {
  timestamp: new Date().toISOString(),
  cpuUsage: 45.0,
  txPoolPending: 50,
  gasUsedRatio: 0.3,
  blockHeight: 1000,
  blockInterval: 2.0,
  currentVcpu: 1,
};

describe('detection-pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AUTO_REMEDIATION_ENABLED;
  });

  describe('runDetectionPipeline', () => {
    it('should return empty anomalies when none detected', async () => {
      vi.mocked(detectAnomalies).mockReturnValue([]);

      const result = await runDetectionPipeline(mockDataPoint);

      expect(result.anomalies).toEqual([]);
      expect(result.deepAnalysisTriggered).toBe(false);
      expect(resolveActiveEventIfExists).toHaveBeenCalled();
    });

    it('should detect anomalies and create event', async () => {
      const mockAnomalies = [
        {
          isAnomaly: true,
          metric: 'cpuUsage' as const,
          value: 95,
          zScore: 3.2,
          direction: 'above' as const,
          description: 'High CPU',
          rule: 'z-score' as const,
        },
      ];
      vi.mocked(detectAnomalies).mockReturnValue(mockAnomalies);

      const result = await runDetectionPipeline(mockDataPoint);

      expect(result.anomalies).toHaveLength(1);
      expect(result.activeEventId).toBe('test-event-1');
      expect(result.deepAnalysisTriggered).toBe(true);
      expect(createOrUpdateEvent).toHaveBeenCalledWith(mockAnomalies);
    });

    it('should not trigger deep analysis if already exists', async () => {
      const mockAnomalies = [
        { isAnomaly: true, metric: 'cpuUsage' as const, value: 95, zScore: 3.2, direction: 'above' as const, description: 'High CPU', rule: 'z-score' as const },
      ];
      vi.mocked(detectAnomalies).mockReturnValue(mockAnomalies);
      vi.mocked(createOrUpdateEvent).mockResolvedValue({
        id: 'test-event-1',
        timestamp: Date.now(),
        anomalies: mockAnomalies,
        status: 'active',
        alerts: [],
        deepAnalysis: {
          severity: 'medium',
          anomalyType: 'performance',
          correlations: [],
          predictedImpact: 'Already analyzed',
          suggestedActions: [],
          relatedComponents: [],
          timestamp: new Date().toISOString(),
        },
      });

      const result = await runDetectionPipeline(mockDataPoint);

      expect(result.deepAnalysisTriggered).toBe(false);
    });

    it('should resolve active event when no anomalies', async () => {
      vi.mocked(detectAnomalies).mockReturnValue([]);
      vi.mocked(getActiveEventId).mockResolvedValue('prev-event-id');

      const result = await runDetectionPipeline(mockDataPoint);

      expect(resolveActiveEventIfExists).toHaveBeenCalled();
      expect(result.activeEventId).toBe('prev-event-id');
    });

    it('should pass balances to detectAnomalies when provided', async () => {
      vi.mocked(detectAnomalies).mockReturnValue([]);
      const balances = { batcherBalanceEth: 0.3, proposerBalanceEth: 0.009 };

      await runDetectionPipeline(mockDataPoint, balances);

      expect(detectAnomalies).toHaveBeenCalledWith(
        mockDataPoint,
        expect.any(Array),
        balances
      );
    });

    it('should work without balances parameter', async () => {
      vi.mocked(detectAnomalies).mockReturnValue([]);

      await runDetectionPipeline(mockDataPoint);

      expect(detectAnomalies).toHaveBeenCalledWith(
        mockDataPoint,
        expect.any(Array),
        undefined
      );
    });

    it('should handle detection errors gracefully', async () => {
      vi.mocked(detectAnomalies).mockImplementation(() => {
        throw new Error('Detection engine failed');
      });

      await expect(runDetectionPipeline(mockDataPoint)).rejects.toThrow('Detection engine failed');
    });
  });
});
