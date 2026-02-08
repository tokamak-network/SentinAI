/**
 * Scheduler Module
 * Manages cron jobs for 5-minute metric snapshots and daily report generation.
 * Initialized from Next.js instrumentation hook on server start.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { takeSnapshot, getAccumulatedData, initializeAccumulator } from '@/lib/daily-accumulator';
import { generateDailyReport } from '@/lib/daily-report-generator';

let initialized = false;
let snapshotTask: ScheduledTask | null = null;
let reportTask: ScheduledTask | null = null;
let snapshotTaskRunning = false;
let reportTaskRunning = false;

/**
 * Initialize cron jobs. Idempotent — safe to call multiple times.
 */
export function initializeScheduler(): void {
  if (initialized) {
    console.log('[Scheduler] Already initialized, skipping');
    return;
  }

  // Initialize accumulator for today
  initializeAccumulator();

  // 5-minute snapshot cron
  snapshotTask = cron.schedule('*/5 * * * *', () => {
    if (snapshotTaskRunning) return;
    snapshotTaskRunning = true;
    try {
      takeSnapshot();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Scheduler] Snapshot error:', msg);
    } finally {
      snapshotTaskRunning = false;
    }
  }, { timezone: 'Asia/Seoul' });

  // Daily report at 23:55 KST
  reportTask = cron.schedule('55 23 * * *', async () => {
    if (reportTaskRunning) return;
    reportTaskRunning = true;
    try {
      console.log('[Scheduler] Starting daily report generation...');
      const data = getAccumulatedData();
      if (data) {
        const result = await generateDailyReport(data);
        if (result.success) {
          console.log(`[Scheduler] Daily report generated: ${result.reportPath}`);
        } else {
          console.error(`[Scheduler] Daily report failed: ${result.error}`);
        }
      } else {
        console.warn('[Scheduler] No accumulated data available for report');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Scheduler] Report generation error:', msg);
    } finally {
      reportTaskRunning = false;
    }
  }, { timezone: 'Asia/Seoul' });

  initialized = true;
  console.log('[Scheduler] Initialized — snapshot: */5 * * * *, report: 55 23 * * * (KST)');
}

/**
 * Stop all cron jobs (for testing).
 */
export function stopScheduler(): void {
  if (snapshotTask) {
    snapshotTask.stop();
    snapshotTask = null;
  }
  if (reportTask) {
    reportTask.stop();
    reportTask = null;
  }
  initialized = false;
  console.log('[Scheduler] Stopped');
}

/**
 * Get scheduler status.
 */
export function getSchedulerStatus(): {
  initialized: boolean;
  snapshotTaskRunning: boolean;
  reportTaskRunning: boolean;
} {
  return {
    initialized,
    snapshotTaskRunning,
    reportTaskRunning,
  };
}
