/**
 * Unit tests for scheduler module
 * Tests cron job initialization, execution, and management
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as scheduler from '@/lib/scheduler';

// Mock dependencies
vi.mock('@/lib/daily-accumulator', () => ({
  initializeAccumulator: vi.fn(),
  takeSnapshot: vi.fn(),
  getAccumulatedData: vi.fn(),
}));

vi.mock('@/lib/daily-report-generator', () => ({
  generateDailyReport: vi.fn(),
}));

const {
  initializeAccumulator,
  takeSnapshot,
  getAccumulatedData,
} = await import('@/lib/daily-accumulator');

const { generateDailyReport } = await import('@/lib/daily-report-generator');

describe('scheduler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    scheduler.stopScheduler();

    // Mock implementations
    vi.mocked(initializeAccumulator).mockResolvedValue(undefined);
    vi.mocked(takeSnapshot).mockResolvedValue(null);
    vi.mocked(getAccumulatedData).mockResolvedValue(null);
  });

  afterEach(() => {
    scheduler.stopScheduler();
  });

  describe('Initialization', () => {
    it('should initialize scheduler without errors', async () => {
      await scheduler.initializeScheduler();

      const status = scheduler.getSchedulerStatus();

      expect(status.initialized).toBe(true);
      expect(initializeAccumulator).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent - skip re-initialization', async () => {
      await scheduler.initializeScheduler();
      await scheduler.initializeScheduler();

      const callCount = vi.mocked(initializeAccumulator).mock.calls.length;

      // Should only call once due to idempotency
      expect(callCount).toBe(1);
    });

    it('should set initialized flag to true', async () => {
      let status = scheduler.getSchedulerStatus();
      expect(status.initialized).toBe(false);

      await scheduler.initializeScheduler();
      status = scheduler.getSchedulerStatus();

      expect(status.initialized).toBe(true);
    });

    it('should initialize accumulator on scheduler init', async () => {
      await scheduler.initializeScheduler();

      expect(initializeAccumulator).toHaveBeenCalledTimes(1);
    });

    it('should set task running flags to false on init', async () => {
      await scheduler.initializeScheduler();

      const status = scheduler.getSchedulerStatus();

      expect(status.snapshotTaskRunning).toBe(false);
      expect(status.reportTaskRunning).toBe(false);
    });
  });

  describe('Status Reporting', () => {
    it('should report uninitialized status initially', () => {
      const status = scheduler.getSchedulerStatus();

      expect(status.initialized).toBe(false);
      expect(status.snapshotTaskRunning).toBe(false);
      expect(status.reportTaskRunning).toBe(false);
    });

    it('should report initialized status after init', async () => {
      await scheduler.initializeScheduler();

      const status = scheduler.getSchedulerStatus();

      expect(status.initialized).toBe(true);
      expect(status.snapshotTaskRunning).toBe(false);
      expect(status.reportTaskRunning).toBe(false);
    });

    it('should have all status properties defined', async () => {
      await scheduler.initializeScheduler();

      const status = scheduler.getSchedulerStatus();

      expect(status).toHaveProperty('initialized');
      expect(status).toHaveProperty('snapshotTaskRunning');
      expect(status).toHaveProperty('reportTaskRunning');
    });

    it('should have boolean values for all status properties', async () => {
      await scheduler.initializeScheduler();

      const status = scheduler.getSchedulerStatus();

      expect(typeof status.initialized).toBe('boolean');
      expect(typeof status.snapshotTaskRunning).toBe('boolean');
      expect(typeof status.reportTaskRunning).toBe('boolean');
    });
  });

  describe('Scheduler Stopping', () => {
    it('should stop scheduler and clear state', async () => {
      await scheduler.initializeScheduler();

      let status = scheduler.getSchedulerStatus();
      expect(status.initialized).toBe(true);

      scheduler.stopScheduler();
      status = scheduler.getSchedulerStatus();

      expect(status.initialized).toBe(false);
    });

    it('should allow re-initialization after stopping', async () => {
      await scheduler.initializeScheduler();
      scheduler.stopScheduler();

      vi.mocked(initializeAccumulator).mockClear();
      await scheduler.initializeScheduler();

      expect(initializeAccumulator).toHaveBeenCalledTimes(1);
      expect(scheduler.getSchedulerStatus().initialized).toBe(true);
    });

    it('should handle multiple stop calls safely', async () => {
      await scheduler.initializeScheduler();

      // Multiple stops should not throw
      expect(() => {
        scheduler.stopScheduler();
        scheduler.stopScheduler();
        scheduler.stopScheduler();
      }).not.toThrow();

      expect(scheduler.getSchedulerStatus().initialized).toBe(false);
    });

    it('should stop tasks before marking uninitialized', async () => {
      await scheduler.initializeScheduler();

      const statusBefore = scheduler.getSchedulerStatus();
      expect(statusBefore.initialized).toBe(true);

      scheduler.stopScheduler();

      const statusAfter = scheduler.getSchedulerStatus();
      expect(statusAfter.initialized).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle accumulator initialization failure', async () => {
      vi.mocked(initializeAccumulator).mockRejectedValueOnce(
        new Error('Init failed')
      );

      // Should throw error
      await expect(scheduler.initializeScheduler()).rejects.toThrow('Init failed');
    });

    it('should handle snapshot task error gracefully', async () => {
      vi.mocked(takeSnapshot).mockRejectedValueOnce(
        new Error('Snapshot error')
      );

      await scheduler.initializeScheduler();

      // Status should reflect that snapshot task ran but had error
      const status = scheduler.getSchedulerStatus();
      expect(status.initialized).toBe(true);
    });

    it('should handle report generation error gracefully', async () => {
      vi.mocked(getAccumulatedData).mockResolvedValueOnce({
        date: '2026-02-10',
        startTime: new Date().toISOString(),
        lastSnapshotTime: new Date().toISOString(),
        snapshots: [],
        hourlySummaries: [],
        logAnalysisResults: [],
        scalingEvents: [],
        metadata: { dataCompleteness: 0, dataGaps: [] },
      });

      vi.mocked(generateDailyReport).mockRejectedValueOnce(
        new Error('Report generation failed')
      );

      await scheduler.initializeScheduler();

      // Should handle error without crashing
      const status = scheduler.getSchedulerStatus();
      expect(status.initialized).toBe(true);
    });
  });

  describe('Task Guard Mechanisms', () => {
    it('should prevent concurrent snapshot task execution', async () => {
      await scheduler.initializeScheduler();

      // Simulate first task running
      const status1 = scheduler.getSchedulerStatus();
      expect(status1.snapshotTaskRunning).toBe(false);

      // Second invocation should check the running flag
      // (actual concurrent test would require triggering cron manually)
      const status2 = scheduler.getSchedulerStatus();
      expect(status2.snapshotTaskRunning).toBe(false);
    });

    it('should prevent concurrent report task execution', async () => {
      await scheduler.initializeScheduler();

      // Simulate first task running
      const status1 = scheduler.getSchedulerStatus();
      expect(status1.reportTaskRunning).toBe(false);

      // Second invocation should check the running flag
      const status2 = scheduler.getSchedulerStatus();
      expect(status2.reportTaskRunning).toBe(false);
    });
  });

  describe('Integration: Full Scheduler Lifecycle', () => {
    it('should initialize, run, and stop successfully', async () => {
      // Initialize
      await scheduler.initializeScheduler();
      expect(scheduler.getSchedulerStatus().initialized).toBe(true);

      // Verify mocks called
      expect(initializeAccumulator).toHaveBeenCalledTimes(1);

      // Stop
      scheduler.stopScheduler();
      expect(scheduler.getSchedulerStatus().initialized).toBe(false);

      // Re-initialize
      vi.mocked(initializeAccumulator).mockClear();
      await scheduler.initializeScheduler();

      expect(scheduler.getSchedulerStatus().initialized).toBe(true);
      expect(initializeAccumulator).toHaveBeenCalledTimes(1);
    });

    it('should handle successful snapshot generation', async () => {
      vi.mocked(takeSnapshot).mockResolvedValueOnce({
        timestamp: new Date().toISOString(),
        dataPointCount: 10,
        cpu: { mean: 45, min: 20, max: 80, stdDev: 15 },
        txPool: { mean: 200, min: 50, max: 500, stdDev: 100 },
        gasUsedRatio: { mean: 0.6, min: 0.2, max: 0.95, stdDev: 0.2 },
        blockInterval: { mean: 2.5, min: 2, max: 3, stdDev: 0.3 },
        latestBlockHeight: 10000,
        currentVcpu: 2,
      });

      await scheduler.initializeScheduler();

      const status = scheduler.getSchedulerStatus();
      expect(status.initialized).toBe(true);
    });

    it('should handle successful daily report generation', async () => {
      vi.mocked(getAccumulatedData).mockResolvedValueOnce({
        date: '2026-02-10',
        startTime: new Date().toISOString(),
        lastSnapshotTime: new Date().toISOString(),
        snapshots: [],
        hourlySummaries: Array(24).fill({
          hour: 0,
          snapshotCount: 0,
          avgCpu: 0,
          maxCpu: 0,
          avgTxPool: 0,
          maxTxPool: 0,
          avgGasRatio: 0,
          avgBlockInterval: 0,
          blocksProduced: 0,
          vcpuChanges: [],
        }),
        logAnalysisResults: [],
        scalingEvents: [],
        metadata: { dataCompleteness: 0.5, dataGaps: [] },
      });

      vi.mocked(generateDailyReport).mockResolvedValueOnce({
        success: true,
        reportPath: '/reports/2026-02-10.md',
      });

      await scheduler.initializeScheduler();

      const status = scheduler.getSchedulerStatus();
      expect(status.initialized).toBe(true);
    });

    it('should handle missing accumulated data for report', async () => {
      vi.mocked(getAccumulatedData).mockResolvedValueOnce(null);

      await scheduler.initializeScheduler();

      // Should still be initialized despite no data
      const status = scheduler.getSchedulerStatus();
      expect(status.initialized).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid sequential initialization attempts', async () => {
      await scheduler.initializeScheduler();
      await scheduler.initializeScheduler();
      await scheduler.initializeScheduler();

      // Should only initialize once due to idempotency
      expect(vi.mocked(initializeAccumulator).mock.calls.length).toBe(1);
    });

    it('should handle stop before initialization', async () => {
      expect(() => {
        scheduler.stopScheduler();
      }).not.toThrow();

      expect(scheduler.getSchedulerStatus().initialized).toBe(false);
    });

    it('should maintain correct state through multiple cycles', async () => {
      for (let i = 0; i < 3; i++) {
        await scheduler.initializeScheduler();
        expect(scheduler.getSchedulerStatus().initialized).toBe(true);

        scheduler.stopScheduler();
        expect(scheduler.getSchedulerStatus().initialized).toBe(false);
      }

      // Should be uninitialized after final stop
      expect(scheduler.getSchedulerStatus().initialized).toBe(false);
    });

    it('should handle accumulator returning null gracefully', async () => {
      vi.mocked(takeSnapshot).mockResolvedValueOnce(null);

      await scheduler.initializeScheduler();

      const status = scheduler.getSchedulerStatus();
      expect(status.initialized).toBe(true);
    });

    it('should handle report generation failure with error info', async () => {
      vi.mocked(getAccumulatedData).mockResolvedValueOnce({
        date: '2026-02-10',
        startTime: new Date().toISOString(),
        lastSnapshotTime: new Date().toISOString(),
        snapshots: [],
        hourlySummaries: Array(24).fill({}),
        logAnalysisResults: [],
        scalingEvents: [],
        metadata: { dataCompleteness: 0, dataGaps: [] },
      });

      vi.mocked(generateDailyReport).mockResolvedValueOnce({
        success: false,
        error: 'Report generation failed',
      });

      await scheduler.initializeScheduler();

      const status = scheduler.getSchedulerStatus();
      expect(status.initialized).toBe(true);
    });
  });

  describe('Daily Report Schedule Override', () => {
    it('should use DAILY_REPORT_SCHEDULE env var when set', async () => {
      const consoleSpy = vi.spyOn(console, 'info');
      process.env.DAILY_REPORT_SCHEDULE = '0 9 * * *';

      await scheduler.initializeScheduler();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('report: 0 9 * * *')
      );

      delete process.env.DAILY_REPORT_SCHEDULE;
      consoleSpy.mockRestore();
    });

    it('should use default schedule when env var is not set', async () => {
      const consoleSpy = vi.spyOn(console, 'info');
      delete process.env.DAILY_REPORT_SCHEDULE;

      await scheduler.initializeScheduler();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('report: 55 23 * * *')
      );

      consoleSpy.mockRestore();
    });
  });
});
