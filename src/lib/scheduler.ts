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
import { getStore } from '@/lib/redis-store';
import { createLogger } from '@/lib/logger';
import { getAgentOrchestrator } from '@/core/agent-orchestrator';

const logger = createLogger('Scheduler');

type AgentCycleSource = 'seed'; // V1 sources ('schedule', 'watchdog-recovery', 'anomaly-event') removed

interface AgentCycleExecutionResult {
  outcome: 'completed' | 'error' | 'failed' | 'skipped';
  detail: string;
}

let initialized = false;
let snapshotTask: ScheduledTask | null = null;
let reportTask: ScheduledTask | null = null;
let scheduledScalingTask: ScheduledTask | null = null;
let patternMinerTask: ScheduledTask | null = null;
let snapshotTaskRunning = false;
let reportTaskRunning = false;
let scheduledScalingTaskRunning = false;
let patternMinerTaskRunning = false;

// V1 watchdog and heartbeat management functions removed

// Agent loop enable check — defaults to true if L2_RPC_URL is set
function isAgentLoopEnabled(): boolean {
  if (process.env.AGENT_LOOP_ENABLED === 'false') return false;
  if (process.env.AGENT_LOOP_ENABLED === 'true') return true;
  // Auto-enable if L2_RPC_URL is configured
  return !!process.env.L2_RPC_URL;
}

/**
 * @deprecated V1 agent cycle removed — kept as stub for backward compatibility (seed API only)
 * V2 event-driven orchestrator handles all observe-detect-decide-act cycles
 */
export async function executeAgentCycle(source: AgentCycleSource): Promise<AgentCycleExecutionResult> {
  logger.debug(`[V1-STUB] executeAgentCycle(${source}) called but V1 removed; V2 orchestrator is active`);
  return {
    outcome: 'skipped',
    detail: 'V1 agent cycle removed — V2 orchestrator is active',
  };
}

// V1 watchdog and anomaly trigger functionality removed — V2 uses event-driven orchestrator

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

  // V1 serial agent loop removed — V2 event-driven orchestrator handles observe-detect-decide-act
  if (!isAgentLoopEnabled()) {
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

  // PatternMiner: daily at 00:05 UTC — analyze operation ledger → generate/evolve playbooks (Proposal 32)
  patternMinerTask = cron.schedule('5 0 * * *', async () => {
    if (patternMinerTaskRunning) return;
    patternMinerTaskRunning = true;
    try {
      const instanceId = process.env.SENTINAI_INSTANCE_ID ?? 'default';
      const { listOperationLedger, listPlaybooks, upsertPlaybook } = await import('@/core/playbook-system/store');
      const { analyzeIncidentPatterns } = await import('@/core/playbook-system/incident-analyzer');
      const { generatePlaybookFromPattern, mergePatternIntoPlaybook } = await import('@/core/playbook-system/playbook-generator');

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

  // AgentOrchestrator v2 — always active (V1 removed)
  if (isAgentLoopEnabled()) {
    const orchestrator = getAgentOrchestrator();
    const instancesEnv = process.env.SENTINAI_INSTANCES;
    if (instancesEnv) {
      try {
        const instances = JSON.parse(instancesEnv) as Array<{ instanceId: string; protocolId: string; rpcUrl?: string }>;
        for (const inst of instances) {
          orchestrator.startInstance(inst.instanceId, inst.protocolId, inst.rpcUrl);
        }
        logger.info(`AgentOrchestrator started ${instances.length} instances`);
      } catch {
        logger.warn('Failed to parse SENTINAI_INSTANCES env var');
      }
    } else {
      // Default: start a single instance using L2_RPC_URL
      const defaultInstanceId = process.env.SENTINAI_DEFAULT_INSTANCE_ID ?? 'default';
      const defaultProtocolId = process.env.SENTINAI_DEFAULT_PROTOCOL_ID ?? 'opstack-l2';
      const defaultRpcUrl = process.env.L2_RPC_URL;
      orchestrator.startInstance(defaultInstanceId, defaultProtocolId, defaultRpcUrl);
      logger.info(`AgentOrchestrator started default instance (instanceId=${defaultInstanceId})`);
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
  snapshotTaskRunning = false;
  reportTaskRunning = false;
  scheduledScalingTaskRunning = false;
  patternMinerTaskRunning = false;
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
    agentLoopEnabled: isAgentLoopEnabled(),
    agentV2Enabled: true, // V2 is always active (V1 removed)
    snapshotTaskRunning,
    reportTaskRunning,
    scheduledScalingTaskRunning,
  };
}
