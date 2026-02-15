/**
 * Scheduler Module
 * Manages cron jobs for:
 *   - Agent loop (30s): autonomous observe-detect-decide-act cycle
 *   - Metric snapshots (5min): daily accumulator for reports
 *   - Daily report (23:55 KST): AI-powered daily summary
 * Initialized from Next.js instrumentation hook on server start.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { takeSnapshot, getAccumulatedData, initializeAccumulator } from '@/lib/daily-accumulator';
import { generateDailyReport } from '@/lib/daily-report-generator';
import { deliverDailyReport } from '@/lib/daily-report-mailer';
import { runAgentCycle } from '@/lib/agent-loop';

let initialized = false;
let agentTask: ScheduledTask | null = null;
let snapshotTask: ScheduledTask | null = null;
let reportTask: ScheduledTask | null = null;
let agentTaskRunning = false;
let snapshotTaskRunning = false;
let reportTaskRunning = false;

// Agent loop enable check — defaults to true if L2_RPC_URL is set
function isAgentLoopEnabled(): boolean {
  if (process.env.AGENT_LOOP_ENABLED === 'false') return false;
  if (process.env.AGENT_LOOP_ENABLED === 'true') return true;
  // Auto-enable if L2_RPC_URL is configured
  return !!process.env.L2_RPC_URL;
}

/**
 * Initialize cron jobs. Idempotent — safe to call multiple times.
 */
export async function initializeScheduler(): Promise<void> {
  if (initialized) {
    console.log('[Scheduler] Already initialized, skipping');
    return;
  }

  // Initialize accumulator for today
  await initializeAccumulator();

  // Agent loop: every 60 seconds — autonomous observe-detect-decide-act
  // Increased from 30s to 60s to prevent scheduler overload
  if (isAgentLoopEnabled()) {
    agentTask = cron.schedule('*/60 * * * * *', async () => {
      if (agentTaskRunning) return;
      agentTaskRunning = true;
      const startTime = Date.now();
      try {
        // 50-second timeout to ensure completion before next cycle
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Agent loop timeout after 50s')), 50000)
        );
        const result = await Promise.race([runAgentCycle(), timeoutPromise]) as any;
        const duration = Date.now() - startTime;
        if (result.phase === 'error') {
          console.error('[AgentLoop] Cycle error:', result.error);
        } else if (result.scaling?.executed) {
          console.log(`[AgentLoop] Scaling executed: ${result.scaling.reason} (${duration}ms)`);
        } else {
          console.log(`[AgentLoop] Cycle completed (${duration}ms)`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Scheduler] Agent loop error:', msg);
      } finally {
        agentTaskRunning = false;
      }
    });
    console.log('[Scheduler] Agent loop enabled (every 60s, 50s timeout)');
  } else {
    console.log('[Scheduler] Agent loop disabled (set AGENT_LOOP_ENABLED=true or L2_RPC_URL to enable)');
  }

  // 5-minute snapshot cron
  snapshotTask = cron.schedule('*/5 * * * *', async () => {
    if (snapshotTaskRunning) return;
    snapshotTaskRunning = true;
    try {
      await takeSnapshot();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Scheduler] Snapshot error:', msg);
    } finally {
      snapshotTaskRunning = false;
    }
  }, { timezone: 'Asia/Seoul' });

  // Daily report — configurable via DAILY_REPORT_SCHEDULE env var
  const reportSchedule = process.env.DAILY_REPORT_SCHEDULE || '55 23 * * *';
  reportTask = cron.schedule(reportSchedule, async () => {
    if (reportTaskRunning) return;
    reportTaskRunning = true;
    try {
      console.log('[Scheduler] Starting daily report generation...');
      const data = await getAccumulatedData();
      if (data) {
        const result = await generateDailyReport(data);
        if (result.success) {
          console.log(`[Scheduler] Daily report generated: ${result.reportPath}`);

          // Deliver report via Slack (신규 추가)
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const deliveryResult = await deliverDailyReport(yesterday);
          if (deliveryResult.success) {
            console.log(`[Scheduler] Daily report delivered via ${deliveryResult.method}`);
          } else {
            console.error(`[Scheduler] Daily report delivery failed: ${deliveryResult.error}`);
          }
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
  console.log(`[Scheduler] Initialized — snapshot: */5 * * * *, report: ${reportSchedule} (KST)`);
}

/**
 * Stop all cron jobs (for testing).
 */
export function stopScheduler(): void {
  if (agentTask) {
    agentTask.stop();
    agentTask = null;
  }
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
  agentLoopEnabled: boolean;
  agentTaskRunning: boolean;
  snapshotTaskRunning: boolean;
  reportTaskRunning: boolean;
} {
  return {
    initialized,
    agentLoopEnabled: isAgentLoopEnabled(),
    agentTaskRunning,
    snapshotTaskRunning,
    reportTaskRunning,
  };
}
