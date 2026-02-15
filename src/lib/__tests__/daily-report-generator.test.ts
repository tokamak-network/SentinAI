/**
 * Unit tests for daily-report-generator module
 * Tests report generation with AI and fallback
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateDailyReport } from '@/lib/daily-report-generator';
import type { DailyAccumulatedData } from '@/types/daily-report';

// Mock dependencies
vi.mock('@/lib/ai-client', () => ({
  chatCompletion: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory')),
  },
}));

const { chatCompletion } = await import('@/lib/ai-client');

/**
 * Helper: Create mock daily accumulated data
 */
function createDailyData(overrides?: Partial<DailyAccumulatedData>): DailyAccumulatedData {
  return {
    date: '2026-02-10',
    startTime: new Date().toISOString(),
    lastSnapshotTime: new Date().toISOString(),
    snapshots: [
      {
        timestamp: new Date().toISOString(),
        dataPointCount: 10,
        cpu: { mean: 45, min: 20, max: 80, stdDev: 15 },
        txPool: { mean: 200, min: 50, max: 500, stdDev: 100 },
        gasUsedRatio: { mean: 0.6, min: 0.2, max: 0.95, stdDev: 0.2 },
        blockInterval: { mean: 2.5, min: 2, max: 3, stdDev: 0.3 },
        latestBlockHeight: 10000,
        currentVcpu: 2,
      },
    ],
    hourlySummaries: Array(24)
      .fill(null)
      .map((_, hour) => ({
        hour,
        snapshotCount: 0,
        avgCpu: 0,
        maxCpu: 0,
        avgTxPool: 0,
        maxTxPool: 0,
        avgGasRatio: 0,
        avgBlockInterval: 0,
        blocksProduced: 0,
        vcpuChanges: [],
      })),
    logAnalysisResults: [],
    scalingEvents: [],
    metadata: {
      dataCompleteness: 0.5,
      dataGaps: [],
    },
    ...overrides,
  };
}

describe('daily-report-generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Report Generation', () => {
    it('should generate report successfully with AI', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '# Daily Report\n\nAll systems operating normally.',
        stopReason: 'end_turn',
        model: 'claude-sonnet',
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      const data = createDailyData();
      const result = await generateDailyReport(data);

      expect(result.success).toBe(true);
      expect(result.reportPath).toBeTruthy();
    });

    it('should include AI model in response', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '# Report',
        stopReason: 'end_turn',
        model: 'claude-sonnet-4-5',
        usage: {},
      });

      const result = await generateDailyReport(createDailyData());

      expect(result.metadata?.aiModel).toBeTruthy();
    });

    it('should set generatedAt timestamp', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '# Report',
        stopReason: 'end_turn',
      });

      const result = await generateDailyReport(createDailyData());

      expect(result.metadata?.generatedAt).toBeTruthy();
    });

    it('should include processing time in metadata', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '# Report',
        stopReason: 'end_turn',
      });

      const result = await generateDailyReport(createDailyData());

      expect(result.metadata?.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.metadata?.processingTimeMs).toBe('number');
    });
  });

  describe('Existing Report Handling', () => {
    it('should skip generation if report exists (without force)', async () => {
      const data = createDailyData();
      const fs = await import('fs/promises');

      // First call: report doesn't exist, so readFile throws
      vi.mocked(fs.default.readFile).mockRejectedValueOnce(new Error('ENOENT'));

      // First call succeeds
      vi.mocked(chatCompletion).mockResolvedValueOnce({
        content: '# Report 1',
        stopReason: 'end_turn',
      });

      await generateDailyReport(data);

      // Second call: report now exists, so readFile returns content
      vi.mocked(fs.default.readFile).mockResolvedValueOnce('# Existing Report');

      // Second call should be skipped
      const result = await generateDailyReport(data);

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should overwrite report with force=true', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '# Report',
        stopReason: 'end_turn',
      });

      const data = createDailyData();

      // Generate twice with force
      const result1 = await generateDailyReport(data, { force: true });
      const result2 = await generateDailyReport(data, { force: true });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });

  describe('Data Completeness', () => {
    it('should include data completeness in metadata', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '# Report',
        stopReason: 'end_turn',
      });

      const data = createDailyData({ metadata: { dataCompleteness: 0.75, dataGaps: [] } });
      const result = await generateDailyReport(data);

      expect(result.metadata?.dataCompleteness).toBe(0.75);
    });

    it('should include snapshot count', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '# Report',
        stopReason: 'end_turn',
      });

      const data = createDailyData({
        snapshots: Array(20).fill({
          timestamp: new Date().toISOString(),
          dataPointCount: 10,
          cpu: { mean: 45, min: 20, max: 80, stdDev: 15 },
          txPool: { mean: 200, min: 50, max: 500, stdDev: 100 },
          gasUsedRatio: { mean: 0.6, min: 0.2, max: 0.95, stdDev: 0.2 },
          blockInterval: { mean: 2.5, min: 2, max: 3, stdDev: 0.3 },
          latestBlockHeight: 10000,
          currentVcpu: 2,
        }),
      });

      const result = await generateDailyReport(data);

      expect(result.metadata?.snapshotCount).toBe(20);
    });
  });

  describe('Error Handling', () => {
    it('should handle AI provider failure', async () => {
      vi.mocked(chatCompletion).mockRejectedValue(new Error('AI Provider down'));

      const result = await generateDailyReport(createDailyData());

      // Should return success=true with fallback report
      expect(result.success).toBe(true);
      expect(result.fallback?.enabled).toBe(true);
      expect(result.fallback?.reason).toContain('AI provider error');
      expect(result.metadata?.aiModel).toBe('fallback');
    });

    it('should handle low data gracefully', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '# Report',
        stopReason: 'end_turn',
      });

      const lowDataSnapshots = Array(3)
        .fill(null)
        .map(() => ({
          timestamp: new Date().toISOString(),
          dataPointCount: 5,
          cpu: { mean: 30, min: 20, max: 40, stdDev: 5 },
          txPool: { mean: 100, min: 50, max: 200, stdDev: 30 },
          gasUsedRatio: { mean: 0.5, min: 0.3, max: 0.7, stdDev: 0.1 },
          blockInterval: { mean: 2.0, min: 1.8, max: 2.2, stdDev: 0.1 },
          latestBlockHeight: 5000,
          currentVcpu: 1,
        }));

      const data = createDailyData({ snapshots: lowDataSnapshots });

      // Should still generate despite low data
      const result = await generateDailyReport(data);

      expect(result.metadata?.snapshotCount).toBe(3);
      expect(result.success).toBe(true);
    });

    it('should handle empty snapshots', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '# Report',
        stopReason: 'end_turn',
      });

      const data = createDailyData({ snapshots: [] });

      const result = await generateDailyReport(data);

      expect(result.metadata?.snapshotCount).toBe(0);
    });
  });

  describe('Integration', () => {
    it('should generate complete report with all data', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: `# SentinAI Daily Operations Report — 2026-02-10

## Summary
The system is operating normally.

## Key Metrics
- CPU Average: 45%
- TxPool Average: 200
- Block Interval: 2.5s

## Recommendations
Continue monitoring.`,
        stopReason: 'end_turn',
        model: 'claude-sonnet-4-5',
        usage: { promptTokens: 500, completionTokens: 200 },
      });

      const data = createDailyData({
        scalingEvents: [
          {
            timestamp: new Date().toISOString(),
            reason: 'CPU spike',
            trigger: 'auto',
            fromVcpu: 2,
            toVcpu: 4,
          },
        ],
        logAnalysisResults: [
          {
            timestamp: new Date().toISOString(),
            component: 'op-geth',
            level: 'INFO',
            message: 'All good',
            severity: 'normal',
            summary: 'Normal operation',
          },
        ],
      });

      const result = await generateDailyReport(data);

      expect(result.success).toBe(true);
      expect(result.metadata?.date).toBe('2026-02-10');
      expect(result.metadata?.aiModel).toContain('sonnet');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large snapshot count', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '# Report',
        stopReason: 'end_turn',
      });

      const snapshots = Array(288)
        .fill(null)
        .map((_, i) => ({
          timestamp: new Date(Date.now() - i * 300000).toISOString(),
          dataPointCount: 10,
          cpu: { mean: 45, min: 20, max: 80, stdDev: 15 },
          txPool: { mean: 200, min: 50, max: 500, stdDev: 100 },
          gasUsedRatio: { mean: 0.6, min: 0.2, max: 0.95, stdDev: 0.2 },
          blockInterval: { mean: 2.5, min: 2, max: 3, stdDev: 0.3 },
          latestBlockHeight: 10000,
          currentVcpu: 2,
        }));

      const data = createDailyData({ snapshots });

      const result = await generateDailyReport(data);

      expect(result.metadata?.snapshotCount).toBe(288);
    });

    it('should handle many scaling events', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '# Report',
        stopReason: 'end_turn',
      });

      const scalingEvents = Array(10)
        .fill(null)
        .map((_, i) => ({
          timestamp: new Date(Date.now() - i * 3600000).toISOString(),
          reason: `Scale ${i}`,
          trigger: 'auto',
          fromVcpu: 2 as const,
          toVcpu: 4 as const,
        }));

      const data = createDailyData({ scalingEvents });

      const result = await generateDailyReport(data);

      expect(result.success).toBe(true);
    });
  });
});
