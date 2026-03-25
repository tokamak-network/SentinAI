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
import { applyScheduledScaling, buildScheduleProfile } from '@/lib/scheduled-scaler';
import { cleanupExpiredAgentMemory } from '@/lib/agent-memory';
import { createLogger } from '@/lib/logger';
import { getAgentOrchestrator } from '@/core/agent-orchestrator';
import { publishDailyAgentMarketplaceReputationBatch } from '@/lib/agent-marketplace/reputation-job';

const logger = createLogger('Scheduler');

let initialized = false;
let snapshotTask: ScheduledTask | null = null;
let reportTask: ScheduledTask | null = null;
let scheduledScalingTask: ScheduledTask | null = null;
let patternMinerTask: ScheduledTask | null = null;
let reputationBatchTask: ScheduledTask | null = null;
let snapshotTaskRunning = false;
let reportTaskRunning = false;
let scheduledScalingTaskRunning = false;
let patternMinerTaskRunning = false;
let reputationBatchTaskRunning = false;

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

  // PatternMiner: daily at 00:05 UTC — analyze operation ledger → generate/evolve playbooks (Proposal 32)
  patternMinerTask = cron.schedule('5 0 * * *', async () => {
    if (patternMinerTaskRunning) return;
    patternMinerTaskRunning = true;
    try {
      const instanceId = process.env.SENTINAI_INSTANCE_ID ?? 'default';
      const { listOperationLedger, listPlaybooks, upsertPlaybook } = await import('@/playbooks/learning/store');
      const { analyzeIncidentPatterns } = await import('@/playbooks/learning/incident-analyzer');
      const { generatePlaybookFromPattern, mergePatternIntoPlaybook } = await import('@/playbooks/learning/playbook-generator');

      const { records } = await listOperationLedger(instanceId, { limit: 200 });
      const patterns = analyzeIncidentPatterns(records, { minOccurrences: 3, windowDays: 30 });

      if (patterns.length === 0) {
        logger.info(`[PatternMiner] No recurring patterns found for instance=${instanceId}`);
        return;
      }

      const existing = await listPlaybooks(instanceId);
      let saved = 0;

      for (const pattern of patterns) {
        const candidate = existing.find(
          p => p.triggerSignature === pattern.triggerSignature && p.action === pattern.action
        );
        const next = candidate
          ? mergePatternIntoPlaybook({ playbook: candidate, pattern })
          : generatePlaybookFromPattern({ instanceId, pattern });
        await upsertPlaybook(instanceId, next);
        saved++;
      }

      logger.info(`[PatternMiner] Completed — patterns=${patterns.length} saved=${saved} instance=${instanceId}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[PatternMiner] Error: ' + msg);
    } finally {
      patternMinerTaskRunning = false;
    }
  });

  if (process.env.MARKETPLACE_REPUTATION_ENABLED === 'true') {
    const reputationSchedule = process.env.MARKETPLACE_REPUTATION_SCHEDULE || '10 0 * * *';
    reputationBatchTask = cron.schedule(reputationSchedule, async () => {
      if (reputationBatchTaskRunning) return;
      reputationBatchTaskRunning = true;
      try {
        const now = new Date();
        const from = new Date(now);
        from.setUTCDate(now.getUTCDate() - 1);
        from.setUTCHours(0, 0, 0, 0);
        const to = new Date(from);
        to.setUTCHours(23, 59, 59, 999);

        const result = await publishDailyAgentMarketplaceReputationBatch({
          fromIso: from.toISOString(),
          toIso: to.toISOString(),
          batchTimestamp: Math.floor(now.getTime() / 1000),
        });

        if (result.ok) {
          logger.info(`Agent marketplace reputation batch published: ${result.txHash}`);
        } else {
          logger.warn(`Agent marketplace reputation batch skipped: ${result.error}`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[AgentMarketplaceReputation] Error: ' + msg);
      } finally {
        reputationBatchTaskRunning = false;
      }
    }, { timezone: 'UTC' });
  }

  // AgentOrchestrator v2 — explicit multi-instance mode only.
  // Default single-instance startup is handled by instrumentation.ts (first-run-bootstrap)
  // to avoid duplicate agents when bootstrap creates a Registry instance with a different ID.
  const instancesEnv = process.env.SENTINAI_INSTANCES;
  if (instancesEnv) {
    const orchestrator = getAgentOrchestrator();
    try {
      const instances = JSON.parse(instancesEnv) as Array<{ instanceId: string; protocolId: string; rpcUrl?: string }>;
      for (const inst of instances) {
        orchestrator.startInstance(inst.instanceId, inst.protocolId, inst.rpcUrl);
      }
      logger.info(`AgentOrchestrator started ${instances.length} instances`);
    } catch {
      logger.warn('Failed to parse SENTINAI_INSTANCES env var');
    }
  }

  initialized = true;
  logger.info(
    `Initialized — snapshot: */5 * * * *, report: ${reportSchedule}, scheduled-scaling: 0 * * * * (KST), pattern-miner: 5 0 * * *`
  );
}

/**
 * Stop all cron jobs (for testing).
 */
export function stopScheduler(): void {
  // Stop AgentOrchestrator (always active)
  try {
    getAgentOrchestrator().stopAll();
  } catch {
    // Non-fatal
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
  if (patternMinerTask) {
    patternMinerTask.stop();
    patternMinerTask = null;
  }
  if (reputationBatchTask) {
    reputationBatchTask.stop();
    reputationBatchTask = null;
  }
  snapshotTaskRunning = false;
  reportTaskRunning = false;
  scheduledScalingTaskRunning = false;
  patternMinerTaskRunning = false;
  reputationBatchTaskRunning = false;
  initialized = false;
  logger.info('Stopped');
}

/**
 * Get scheduler status.
 */
export function getSchedulerStatus(): {
  initialized: boolean;
  agentLoopEnabled: boolean;
  agentV2Enabled: boolean;
  snapshotTaskRunning: boolean;
  reportTaskRunning: boolean;
  scheduledScalingTaskRunning: boolean;
} {
  return {
    initialized,
    agentLoopEnabled: true, // V2 orchestrator always active
    agentV2Enabled: true,
    snapshotTaskRunning,
    reportTaskRunning,
    scheduledScalingTaskRunning,
  };
}
