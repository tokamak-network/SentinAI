/**
 * Scheduler Module
 * Manages cron jobs for:
 *   - Agent loop (60s): autonomous observe-detect-decide-act cycle
 *   - Heartbeat watchdog (30s): stale/error detection + alert + self-recovery
 *   - Metric snapshots (5min): daily accumulator for reports
 *   - Daily report (23:55 KST): AI-powered daily summary
 * Initialized from Next.js instrumentation hook on server start.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { takeSnapshot, getAccumulatedData, initializeAccumulator } from '@/lib/daily-accumulator';
import { generateDailyReport } from '@/lib/daily-report-generator';
import { deliverDailyReport } from '@/lib/daily-report-mailer';
import { runAgentCycle } from '@/lib/agent-loop';
import { applyScheduledScaling, buildScheduleProfile } from '@/lib/scheduled-scaler';
import { cleanupExpiredAgentMemory } from '@/lib/agent-memory';
import { getStore } from '@/lib/redis-store';
import { createLogger } from '@/lib/logger';

const logger = createLogger('Scheduler');

const AGENT_CYCLE_TIMEOUT_MS = 50000;
const DEFAULT_AGENT_HEARTBEAT_STALE_SECONDS = 120;
const DEFAULT_WATCHDOG_ALERT_COOLDOWN_SECONDS = 300;
const DEFAULT_WATCHDOG_RECOVERY_COOLDOWN_SECONDS = 120;
const WATCHDOG_SCHEDULE = '*/30 * * * * *';

type AgentCycleSource = 'schedule' | 'watchdog-recovery';
type WatchdogRecoveryStatus = 'idle' | 'success' | 'failed';

interface AgentCycleExecutionResult {
  outcome: 'completed' | 'error' | 'failed' | 'skipped';
  detail: string;
}

interface WatchdogFailureContext {
  source: 'watchdog' | 'heartbeat-write';
  reason: string;
  heartbeatAt: string | null;
  lagSec: number | null;
}

interface HeartbeatHealthCheck {
  healthy: boolean;
  reason?: string;
  heartbeatAt: string | null;
  lagSec: number | null;
}

let initialized = false;
let agentTask: ScheduledTask | null = null;
let snapshotTask: ScheduledTask | null = null;
let reportTask: ScheduledTask | null = null;
let scheduledScalingTask: ScheduledTask | null = null;
let watchdogTask: ScheduledTask | null = null;
let agentTaskRunning = false;
let snapshotTaskRunning = false;
let reportTaskRunning = false;
let scheduledScalingTaskRunning = false;
let watchdogTaskRunning = false;
let watchdogRecoveryRunning = false;
let watchdogFailureStreak = 0;
let watchdogLastError: string | null = null;
let watchdogLastHealthyAt: string | null = null;
let watchdogLastAlertAt: string | null = null;
let watchdogLastRecoveryAt: string | null = null;
let watchdogLastRecoveryStatus: WatchdogRecoveryStatus = 'idle';
let lastWatchdogAlertAtMs = 0;
let lastWatchdogRecoveryAtMs = 0;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || `${fallback}`, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getHeartbeatStaleThresholdSeconds(): number {
  return parsePositiveInt(process.env.AGENT_HEARTBEAT_STALE_SECONDS, DEFAULT_AGENT_HEARTBEAT_STALE_SECONDS);
}

function getWatchdogAlertCooldownSeconds(): number {
  return parsePositiveInt(
    process.env.AGENT_HEARTBEAT_ALERT_COOLDOWN_SECONDS,
    DEFAULT_WATCHDOG_ALERT_COOLDOWN_SECONDS
  );
}

function getWatchdogRecoveryCooldownSeconds(): number {
  return parsePositiveInt(
    process.env.AGENT_HEARTBEAT_RECOVERY_COOLDOWN_SECONDS,
    DEFAULT_WATCHDOG_RECOVERY_COOLDOWN_SECONDS
  );
}

function isHeartbeatWatchdogEnabled(): boolean {
  if (!isAgentLoopEnabled()) return false;

  const value = (process.env.AGENT_HEARTBEAT_WATCHDOG_ENABLED || '').trim().toLowerCase();
  if (value === 'false' || value === '0' || value === 'off' || value === 'no') {
    return false;
  }

  return true;
}

function getAlertWebhookUrl(): string | null {
  const override = process.env.AGENT_HEARTBEAT_ALERT_WEBHOOK_URL;
  if (override && override.trim().length > 0) return override.trim();

  const fallback = process.env.ALERT_WEBHOOK_URL;
  if (fallback && fallback.trim().length > 0) return fallback.trim();

  return null;
}

function maskWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const masked = [...parts.slice(0, -2), '***', '***'].join('/');
      return `${parsed.origin}/${masked}`;
    }
    return `${parsed.origin}/***`;
  } catch {
    return '<invalid-webhook-url>';
  }
}

function buildWatchdogAlertText(
  failure: WatchdogFailureContext,
  recoveryMessage: string
): string {
  const lines = [
    ':rotating_light: SentinAI agent heartbeat watchdog triggered',
    `time: ${new Date().toISOString()}`,
    `host: ${process.env.HOSTNAME || 'unknown-host'}`,
    `reason: ${failure.reason}`,
    `source: ${failure.source}`,
    `heartbeatAt: ${failure.heartbeatAt || 'missing'}`,
    `lagSec: ${failure.lagSec !== null ? failure.lagSec : 'n/a'}`,
    `failureStreak: ${watchdogFailureStreak}`,
    `recovery: ${recoveryMessage}`,
  ];
  return lines.join('\n');
}

async function sendWatchdogAlert(text: string): Promise<void> {
  const webhookUrl = getAlertWebhookUrl();
  if (!webhookUrl) {
    logger.warn('AGENT_HEARTBEAT_ALERT_WEBHOOK_URL/ALERT_WEBHOOK_URL is not configured.');
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`webhook responded ${response.status}: ${body || 'empty response body'}`);
    }

    logger.info(`Watchdog alert sent via ${maskWebhookUrl(webhookUrl)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Watchdog alert delivery failed: ' + message);
  }
}

async function maybeSendWatchdogAlert(
  failure: WatchdogFailureContext,
  recoveryMessage: string
): Promise<void> {
  const nowMs = Date.now();
  const cooldownMs = getWatchdogAlertCooldownSeconds() * 1000;

  if (lastWatchdogAlertAtMs > 0 && nowMs - lastWatchdogAlertAtMs < cooldownMs) {
    return;
  }

  lastWatchdogAlertAtMs = nowMs;
  watchdogLastAlertAt = new Date(nowMs).toISOString();
  await sendWatchdogAlert(buildWatchdogAlertText(failure, recoveryMessage));
}

function markWatchdogHealthy(): void {
  const hadFailures = watchdogFailureStreak > 0 || watchdogLastError !== null;
  watchdogFailureStreak = 0;
  watchdogLastError = null;
  watchdogLastHealthyAt = new Date().toISOString();

  if (hadFailures) {
    logger.info('Agent heartbeat watchdog recovered');
  }
}

async function recordAgentLoopHeartbeat(heartbeatAt: string = new Date().toISOString()): Promise<boolean> {
  try {
    await getStore().setAgentLoopHeartbeat(heartbeatAt);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('Failed to update agent heartbeat: ' + msg);
    return false;
  }
}

// Agent loop enable check — defaults to true if L2_RPC_URL is set
function isAgentLoopEnabled(): boolean {
  if (process.env.AGENT_LOOP_ENABLED === 'false') return false;
  if (process.env.AGENT_LOOP_ENABLED === 'true') return true;
  // Auto-enable if L2_RPC_URL is configured
  return !!process.env.L2_RPC_URL;
}

async function evaluateHeartbeatHealth(): Promise<HeartbeatHealthCheck> {
  try {
    const heartbeatAt = await getStore().getAgentLoopHeartbeat();
    if (!heartbeatAt) {
      return {
        healthy: false,
        reason: 'missing heartbeat key',
        heartbeatAt: null,
        lagSec: null,
      };
    }

    const heartbeatMs = new Date(heartbeatAt).getTime();
    if (!Number.isFinite(heartbeatMs)) {
      return {
        healthy: false,
        reason: `invalid heartbeat timestamp: ${heartbeatAt}`,
        heartbeatAt,
        lagSec: null,
      };
    }

    const lagSec = Math.max(0, Math.floor((Date.now() - heartbeatMs) / 1000));
    const staleThresholdSec = getHeartbeatStaleThresholdSeconds();
    if (lagSec > staleThresholdSec) {
      return {
        healthy: false,
        reason: `heartbeat stale (${lagSec}s > ${staleThresholdSec}s)`,
        heartbeatAt,
        lagSec,
      };
    }

    return {
      healthy: true,
      heartbeatAt,
      lagSec,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      healthy: false,
      reason: `heartbeat read failed: ${message}`,
      heartbeatAt: null,
      lagSec: null,
    };
  }
}

async function executeAgentCycle(source: AgentCycleSource): Promise<AgentCycleExecutionResult> {
  if (agentTaskRunning) {
    return {
      outcome: 'skipped',
      detail: 'agent cycle already running',
    };
  }

  agentTaskRunning = true;
  const startedAt = Date.now();
  let cycleResult: AgentCycleExecutionResult;

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Agent loop timeout after 50s')), AGENT_CYCLE_TIMEOUT_MS)
    );

    const result = await Promise.race([runAgentCycle(), timeoutPromise]) as {
      phase?: string;
      error?: string;
      scaling?: { executed?: boolean; reason?: string };
    };
    const durationMs = Date.now() - startedAt;

    if (result.phase === 'error') {
      const message = result.error || 'Unknown cycle error';
      logger.error(`${source} cycle error: ${message}`);
      cycleResult = {
        outcome: 'error',
        detail: message,
      };
    } else if (result.scaling?.executed) {
      logger.info(`${source} scaling executed: ${result.scaling.reason} (${durationMs}ms)`);
      cycleResult = {
        outcome: 'completed',
        detail: `scaling executed (${durationMs}ms)`,
      };
    } else {
      logger.info(`${source} cycle completed (${durationMs}ms)`);
      cycleResult = {
        outcome: 'completed',
        detail: `cycle completed (${durationMs}ms)`,
      };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Agent loop ${source} execution failed: ${msg}`);
    cycleResult = {
      outcome: 'failed',
      detail: msg,
    };
  }

  const heartbeatRecorded = await recordAgentLoopHeartbeat();
  agentTaskRunning = false;

  if (!heartbeatRecorded) {
    await handleWatchdogFailure(
      {
        source: 'heartbeat-write',
        reason: `heartbeat write failed after ${source} cycle`,
        heartbeatAt: null,
        lagSec: null,
      },
      { allowRecovery: source !== 'watchdog-recovery' }
    );
  }

  return cycleResult;
}

async function triggerWatchdogRecovery(): Promise<{ attempted: boolean; message: string }> {
  if (watchdogRecoveryRunning) {
    return { attempted: false, message: 'recovery already running' };
  }

  const nowMs = Date.now();
  const cooldownMs = getWatchdogRecoveryCooldownSeconds() * 1000;
  if (lastWatchdogRecoveryAtMs > 0 && nowMs - lastWatchdogRecoveryAtMs < cooldownMs) {
    return { attempted: false, message: 'recovery cooldown active' };
  }

  watchdogRecoveryRunning = true;
  lastWatchdogRecoveryAtMs = nowMs;
  watchdogLastRecoveryAt = new Date(nowMs).toISOString();

  try {
    const cycle = await executeAgentCycle('watchdog-recovery');
    if (cycle.outcome === 'skipped') {
      return {
        attempted: false,
        message: `recovery cycle skipped: ${cycle.detail}`,
      };
    }

    if (cycle.outcome === 'completed') {
      watchdogLastRecoveryStatus = 'success';
      return { attempted: true, message: `recovery cycle completed (${cycle.detail})` };
    }

    watchdogLastRecoveryStatus = 'failed';
    return {
      attempted: true,
      message: `recovery cycle ${cycle.outcome}: ${cycle.detail}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    watchdogLastRecoveryStatus = 'failed';
    return { attempted: true, message: `recovery execution failed: ${msg}` };
  } finally {
    watchdogRecoveryRunning = false;
  }
}

async function handleWatchdogFailure(
  failure: WatchdogFailureContext,
  options: { allowRecovery?: boolean } = {}
): Promise<void> {
  watchdogFailureStreak += 1;
  watchdogLastError = `${failure.source}: ${failure.reason}`;

  let recoveryMessage = 'not attempted';
  if (options.allowRecovery !== false) {
    const recovery = await triggerWatchdogRecovery();
    recoveryMessage = recovery.message;
  }

  await maybeSendWatchdogAlert(failure, recoveryMessage);
}

async function runHeartbeatWatchdog(): Promise<void> {
  if (!isHeartbeatWatchdogEnabled()) return;

  const check = await evaluateHeartbeatHealth();
  if (check.healthy) {
    markWatchdogHealthy();
    return;
  }

  await handleWatchdogFailure({
    source: 'watchdog',
    reason: check.reason || 'unknown heartbeat watchdog failure',
    heartbeatAt: check.heartbeatAt,
    lagSec: check.lagSec,
  });
}

/**
 * Initialize cron jobs. Idempotent — safe to call multiple times.
 */
export async function initializeScheduler(): Promise<void> {
  if (initialized) {
    logger.info('Already initialized, skipping');
    return;
  }

  // Initialize accumulator for today
  await initializeAccumulator();

  // Agent loop: every 60 seconds — autonomous observe-detect-decide-act
  // Increased from 30s to 60s to prevent scheduler overload
  if (isAgentLoopEnabled()) {
    const initialHeartbeatRecorded = await recordAgentLoopHeartbeat();
    if (!initialHeartbeatRecorded) {
      await handleWatchdogFailure(
        {
          source: 'heartbeat-write',
          reason: 'initial heartbeat write failed',
          heartbeatAt: null,
          lagSec: null,
        },
        { allowRecovery: false }
      );
    }

    agentTask = cron.schedule('*/60 * * * * *', async () => {
      const cycle = await executeAgentCycle('schedule');
      if (cycle.outcome === 'skipped') {
        return;
      }
    });
    logger.info('Agent loop enabled (every 60s, 50s timeout)');

    if (isHeartbeatWatchdogEnabled()) {
      watchdogTask = cron.schedule(WATCHDOG_SCHEDULE, async () => {
        if (watchdogTaskRunning) return;
        watchdogTaskRunning = true;
        try {
          await runHeartbeatWatchdog();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          await handleWatchdogFailure({
            source: 'watchdog',
            reason: `watchdog execution failed: ${message}`,
            heartbeatAt: null,
            lagSec: null,
          });
        } finally {
          watchdogTaskRunning = false;
        }
      });
      logger.info('Agent heartbeat watchdog enabled (every 30s)');
    } else {
      logger.info('Agent heartbeat watchdog disabled');
    }
  } else {
    logger.info('Agent loop disabled (set AGENT_LOOP_ENABLED=true or L2_RPC_URL to enable)');
  }

  // 5-minute snapshot cron
  snapshotTask = cron.schedule('*/5 * * * *', async () => {
    if (snapshotTaskRunning) return;
    snapshotTaskRunning = true;
    try {
      await takeSnapshot();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Snapshot error: ' + msg);
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
      logger.info('Starting daily report generation...');
      const removedMemoryEntries = await cleanupExpiredAgentMemory();
      if (removedMemoryEntries > 0) {
        logger.info(`Agent memory cleanup removed ${removedMemoryEntries} entries`);
      }
      const data = await getAccumulatedData();
      if (data) {
        const result = await generateDailyReport(data);
        if (result.success) {
          logger.info(`Daily report generated: ${result.reportPath}`);

          // Deliver report via Slack
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const deliveryResult = await deliverDailyReport(yesterday);
          if (deliveryResult.success) {
            logger.info(`Daily report delivered via ${deliveryResult.method}`);
          } else {
            logger.error(`Daily report delivery failed: ${deliveryResult.error}`);
          }
        } else {
          logger.error(`Daily report failed: ${result.error}`);
        }
      } else {
        logger.warn('No accumulated data available for report');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Report generation error: ' + msg);
    } finally {
      reportTaskRunning = false;
    }
  }, { timezone: 'Asia/Seoul' });

  // Scheduled scaling: every hour at minute 0 (KST)
  scheduledScalingTask = cron.schedule('0 * * * *', async () => {
    if (scheduledScalingTaskRunning) return;
    scheduledScalingTaskRunning = true;
    try {
      await buildScheduleProfile();
      const result = await applyScheduledScaling();
      if (result.executed) {
        logger.info(`Scheduled scaling executed: ${result.message}`);
      } else {
        logger.info(`Scheduled scaling skipped: ${result.message}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Scheduled scaling error: ' + msg);
    } finally {
      scheduledScalingTaskRunning = false;
    }
  }, { timezone: 'Asia/Seoul' });

  const watchdogStatus = isHeartbeatWatchdogEnabled() ? WATCHDOG_SCHEDULE : 'off';
  initialized = true;
  logger.info(
    `Initialized — snapshot: */5 * * * *, report: ${reportSchedule}, scheduled-scaling: 0 * * * * (KST), watchdog: ${watchdogStatus}`
  );
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
  if (scheduledScalingTask) {
    scheduledScalingTask.stop();
    scheduledScalingTask = null;
  }
  if (watchdogTask) {
    watchdogTask.stop();
    watchdogTask = null;
  }
  agentTaskRunning = false;
  snapshotTaskRunning = false;
  reportTaskRunning = false;
  scheduledScalingTaskRunning = false;
  watchdogTaskRunning = false;
  watchdogRecoveryRunning = false;
  watchdogFailureStreak = 0;
  watchdogLastError = null;
  watchdogLastHealthyAt = null;
  watchdogLastAlertAt = null;
  watchdogLastRecoveryAt = null;
  watchdogLastRecoveryStatus = 'idle';
  lastWatchdogAlertAtMs = 0;
  lastWatchdogRecoveryAtMs = 0;
  initialized = false;
  logger.info('Stopped');
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
  scheduledScalingTaskRunning: boolean;
  watchdogEnabled: boolean;
  watchdogTaskRunning: boolean;
  watchdogRecoveryRunning: boolean;
  watchdogFailureStreak: number;
  watchdogLastError: string | null;
  watchdogLastHealthyAt: string | null;
  watchdogLastAlertAt: string | null;
  watchdogLastRecoveryAt: string | null;
  watchdogLastRecoveryStatus: WatchdogRecoveryStatus;
} {
  return {
    initialized,
    agentLoopEnabled: isAgentLoopEnabled(),
    agentTaskRunning,
    snapshotTaskRunning,
    reportTaskRunning,
    scheduledScalingTaskRunning,
    watchdogEnabled: isHeartbeatWatchdogEnabled(),
    watchdogTaskRunning,
    watchdogRecoveryRunning,
    watchdogFailureStreak,
    watchdogLastError,
    watchdogLastHealthyAt,
    watchdogLastAlertAt,
    watchdogLastRecoveryAt,
    watchdogLastRecoveryStatus,
  };
}
