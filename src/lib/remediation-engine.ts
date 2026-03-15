/**
 * Layer 4: Auto-Remediation Engine
 * Orchestrator for anomaly detection → automatic recovery loop
 */

import type { AnomalyEvent, DeepAnalysisResult } from '@/types/anomaly';
import type {
  RemediationExecution,
  RemediationConfig,
  CircuitBreakerState,
  ActionResult,
  ExecutionStatus,
  Playbook,
} from '@/types/remediation';
import { matchPlaybook, getPlaybookByName, matchPlaybookWithLayers } from '@/lib/playbook-matcher';
import { executeAction } from '@/lib/action-executor';
import * as store from '@/lib/remediation-store';
import { DEFAULT_SCALING_CONFIG } from '@/types/scaling';
import logger from '@/lib/logger';
import { appendOperationRecord } from '@/core/playbook-system/store';
import type { LedgerOutcome } from '@/core/playbook-system/types';
import { PatternMiner } from '@/lib/playbook-evolution/pattern-miner';
import { getCoreRedis } from '@/core/redis';
import type { IStateStore } from '@/types/redis';

// ============================================================
// UUID Generator
// ============================================================

const INSTANCE_ID = process.env.SENTINAI_INSTANCE_ID ?? 'default';

/**
 * Map ExecutionStatus to LedgerOutcome for operation ledger.
 */
function toLedgerOutcome(status: ExecutionStatus): LedgerOutcome | null {
  switch (status) {
    case 'success': return 'success';
    case 'failed':  return 'failure';
    case 'running': return 'partial';
    case 'skipped': return null; // skipped executions are not recorded
    default:        return null;
  }
}

/**
 * Write a completed remediation execution to the operation ledger.
 * Powers the PatternMiner learning loop (Proposal 32).
 * Failures are swallowed — learning is best-effort and must not affect remediation.
 */
async function writeToOperationLedger(
  execution: RemediationExecution,
  event: AnomalyEvent,
  playbook: Playbook | any // AbstractPlaybook | Playbook
): Promise<void> {
  const outcome = toLedgerOutcome(execution.status);
  if (!outcome) return;

  const primaryAnomaly = event.anomalies[0];
  if (!primaryAnomaly) return;

  // Handle both Playbook and AbstractPlaybook action structures
  const playbookActions = playbook.actions || [];
  const primaryAction =
    playbookActions.find((a: any) => a.safetyLevel !== 'safe')?.type ??
    playbookActions[0]?.type ??
    'unknown';

  const playbookId = (playbook as any).name || (playbook as any).id || 'unknown';

  const startMs = new Date(execution.startedAt).getTime();
  const endMs = execution.completedAt ? new Date(execution.completedAt).getTime() : Date.now();

  const record = {
    operationId: execution.id,
    instanceId: INSTANCE_ID,
    timestamp: execution.startedAt,
    trigger: {
      anomalyType: primaryAnomaly.rule.replace('monotonic-increase', 'monotonic').replace('threshold-breach', 'threshold').replace('zero-drop', 'z-score'),
      metricName: primaryAnomaly.metric,
      zScore: primaryAnomaly.zScore,
      metricValue: primaryAnomaly.value,
    },
    playbookId,
    action: primaryAction,
    outcome,
    resolutionMs: Math.max(0, endMs - startMs),
    verificationPassed: execution.status === 'success',
    failureReason: execution.status !== 'success'
      ? execution.actions.find(a => a.status === 'failed')?.error
      : undefined,
  };

  try {
    await appendOperationRecord(INSTANCE_ID, record);
    logger.debug(`[Remediation] Ledger written: op=${execution.id} outcome=${outcome}`);
  } catch (err) {
    logger.warn('[Remediation] Failed to write operation ledger (non-critical)', { error: err });
  }
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================================
// Simulation Mode Check
// ============================================================

// Remediation is NOT gated by SCALING_SIMULATION_MODE.
// Scaling actions within remediation are gated by k8s-scaler's own simulation check.

// ============================================================
// Pre-Execution Checks
// ============================================================

/**
 * Check all safety gates before execution
 */
async function checkSafetyGates(
  playbookName: string,
  config: RemediationConfig
): Promise<{ allowed: boolean; reason?: string }> {
  // 1. Kill switch
  if (!config.enabled) {
    return { allowed: false, reason: 'Auto-remediation disabled (kill switch)' };
  }

  // 2. Circuit breaker
  if (store.isCircuitOpen(playbookName)) {
    return { allowed: false, reason: 'Circuit breaker open (too many failures)' };
  }

  // 3. Cooldown
  const lastExecution = store.getLastExecutionTime(playbookName);
  if (lastExecution) {
    const cooldownMs = config.cooldownMinutes * 60 * 1000;
    const elapsed = Date.now() - lastExecution.getTime();
    if (elapsed < cooldownMs) {
      const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
      return { allowed: false, reason: `Cooldown active (${remainingSec}s remaining)` };
    }
  }

  // 4. Rate limit: hourly
  const hourlyCount = store.getExecutionCount(60 * 60 * 1000);
  if (hourlyCount >= config.maxExecutionsPerHour) {
    return { allowed: false, reason: 'Hourly rate limit exceeded' };
  }

  // 5. Rate limit: daily
  const dailyCount = store.getExecutionCount(24 * 60 * 60 * 1000);
  if (dailyCount >= config.maxExecutionsPerDay) {
    return { allowed: false, reason: 'Daily rate limit exceeded' };
  }

  return { allowed: true };
}

// ============================================================
// Action Execution
// ============================================================

/**
 * Execute actions sequentially with wait intervals
 */
async function executeActions(
  actions: ActionResult[],
  execution: RemediationExecution,
  config: RemediationConfig
): Promise<void> {
  for (const actionResult of actions) {
    const action = actionResult.action;

    // Safety check: Skip manual actions
    if (action.safetyLevel === 'manual') {
      actionResult.status = 'skipped';
      actionResult.output = 'Manual action requires operator approval';
      actionResult.completedAt = new Date().toISOString();
      continue;
    }

    // Safety check: Skip guarded actions if not allowed
    if (action.safetyLevel === 'guarded' && !config.allowGuardedActions) {
      actionResult.status = 'skipped';
      actionResult.output = 'Guarded action disabled in config';
      actionResult.completedAt = new Date().toISOString();
      continue;
    }

    // Execute action
    try {
      const result = await executeAction(action, DEFAULT_SCALING_CONFIG);
      Object.assign(actionResult, result);
      
      logger.info(`[Remediation] Action ${action.type}: ${result.status}`);

      // Wait after execution if specified
      if (action.waitAfterMs && result.status === 'success') {
        await new Promise(resolve => setTimeout(resolve, action.waitAfterMs));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      actionResult.status = 'failed';
      actionResult.error = message;
      actionResult.completedAt = new Date().toISOString();
      
      // Stop on first critical failure (guarded actions)
      if (action.safetyLevel === 'guarded') {
        logger.error(`[Remediation] Critical action failed: ${action.type}`);
        break;
      }
    }
  }
}

// ============================================================
// Execution Status Evaluation
// ============================================================

/**
 * Determine overall execution status from action results
 */
function evaluateExecutionStatus(actions: ActionResult[]): ExecutionStatus {
  const statuses = actions.map(a => a.status);

  if (statuses.every(s => s === 'success' || s === 'skipped')) {
    return 'success';
  }

  if (statuses.some(s => s === 'failed')) {
    return 'failed';
  }

  if (statuses.some(s => s === 'running')) {
    return 'running';
  }

  return 'pending';
}

// ============================================================
// Main Execution Flow
// ============================================================

/**
 * Execute auto-remediation for an anomaly event
 */
export async function executeRemediation(
  event: AnomalyEvent,
  analysis?: DeepAnalysisResult
): Promise<RemediationExecution> {
  const config = store.getConfig();
  const startTime = new Date().toISOString();

  logger.info(`[Remediation] Triggered for event ${event.id}`);

  // 1. Match playbook (three-layer resolution: abstract → chain-specific)
  const match = await matchPlaybookWithLayers(event, analysis);

  if (!match) {
    logger.info('[Remediation] No matching playbook found in any layer');

    // Create a no-op execution record
    const execution: RemediationExecution = {
      id: generateUUID(),
      playbookName: 'none',
      triggeredBy: 'auto',
      anomalyEventId: event.id,
      status: 'skipped',
      actions: [],
      escalationLevel: 0,
      startedAt: startTime,
      completedAt: new Date().toISOString(),
    };

    store.addExecution(execution);
    return execution;
  }

  const { playbook, actions, source } = match;
  // Extract playbook name from either AbstractPlaybook (id) or Playbook (name)
  const playbookName = source === 'abstract'
    ? (playbook as any).id || (playbook as any).name
    : (playbook as any).name;
  logger.info(`[Remediation] Matched ${source} playbook: ${playbookName}`);

  // 2. Safety gate checks
  const safetyCheck = await checkSafetyGates(playbookName, config);

  if (!safetyCheck.allowed) {
    logger.info(`[Remediation] Blocked: ${safetyCheck.reason}`);

    const execution: RemediationExecution = {
      id: generateUUID(),
      playbookName,
      triggeredBy: 'auto',
      anomalyEventId: event.id,
      status: 'skipped',
      actions: [],
      escalationLevel: 0,
      startedAt: startTime,
      completedAt: new Date().toISOString(),
    };

    store.addExecution(execution);
    return execution;
  }

  // 3. Create execution record
  const execution: RemediationExecution = {
    id: generateUUID(),
    playbookName,
    triggeredBy: 'auto',
    anomalyEventId: event.id,
    status: 'running',
    actions: actions.map(action => ({
      action,
      status: 'pending' as ExecutionStatus,
      startedAt: new Date().toISOString(),
    })),
    escalationLevel: 0,
    startedAt: startTime,
  };

  store.addExecution(execution);
  store.setLastExecutionTime(playbookName, Date.now());

  // 4. Execute actions
  await executeActions(execution.actions, execution, config);

  // 5. Evaluate result
  execution.status = evaluateExecutionStatus(execution.actions);
  execution.completedAt = new Date().toISOString();

  if (execution.status === 'success') {
    store.recordSuccess(playbookName);
    logger.info(`[Remediation] ✅ Success: ${playbookName}`);
  } else if (execution.status === 'failed') {
    store.recordFailure(playbookName);
    logger.info(`[Remediation] ❌ Failed: ${playbookName}`);

    // Try fallback actions if available (from abstract playbooks only)
    const fallbackActions = 'fallback' in playbook ? playbook.fallback : undefined;
    if (fallbackActions && fallbackActions.length > 0) {
      logger.info('[Remediation] Attempting fallback actions...');

      const fallbackResults: ActionResult[] = fallbackActions.map(action => ({
        action,
        status: 'pending' as ExecutionStatus,
        startedAt: new Date().toISOString(),
      }));

      await executeActions(fallbackResults, execution, config);
      
      execution.actions.push(...fallbackResults);
      execution.status = evaluateExecutionStatus(execution.actions);
      execution.completedAt = new Date().toISOString();

      if (execution.status === 'success') {
        store.recordSuccess(playbook.name);
        logger.info('[Remediation] ✅ Fallback succeeded');
      } else {
        execution.escalationLevel = 1;
        logger.info('[Remediation] ⚠️ Fallback also failed, escalating...');
      }
    } else {
      execution.escalationLevel = 1;
    }
  }

  void writeToOperationLedger(execution, event, playbook);

  // Non-blocking: Trigger pattern mining asynchronously
  // Don't await - let it run in background
  triggerPatternMiningAsync(event.anomalies[0]?.metric ?? 'unknown').catch((err) => {
    logger.warn('[RemediationEngine] Pattern mining trigger failed (non-blocking)', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return execution;
}

/**
 * Async pattern mining trigger (fire-and-forget)
 * 1. Check if evolution should trigger (threshold met)
 * 2. If yes, call analyzeAndEvolve
 * 3. Log errors but don't throw
 */
async function triggerPatternMiningAsync(anomalyType: string): Promise<void> {
  try {
    const redis = getCoreRedis();
    if (!redis) {
      logger.debug('[PatternMiner] Skipping: Redis not available (in-memory mode)');
      return;
    }

    // We need to get the state store - try to get it from global context
    // Since we don't have direct access to IStateStore here, we'll create a minimal mock
    // for the PatternMiner to work with
    const storeForMiner: Partial<IStateStore> = {
      getOperationRecordCount: async () => 0,
      getLastEvolutionTime: async () => 0,
      getOperationRecords: async () => [],
      setLastEvolutionTime: async () => {},
    };

    const miner = new PatternMiner(storeForMiner as IStateStore, redis);

    const shouldTrigger = await miner.shouldTriggerEvolution();

    if (shouldTrigger) {
      logger.debug('[PatternMiner] Evolution threshold met, starting analyzeAndEvolve');
      await miner.analyzeAndEvolve();
    }
  } catch (err) {
    // Non-blocking: silently fail (log only)
    logger.warn('[PatternMiner] Trigger failed (non-blocking)', {
      anomalyType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Manually execute a playbook by name
 */
export async function executePlaybook(
  playbookName: string,
  triggeredBy: 'manual' = 'manual'
): Promise<RemediationExecution> {
  const config = store.getConfig();
  const startTime = new Date().toISOString();

  const playbook = getPlaybookByName(playbookName);

  if (!playbook) {
    throw new Error(`Playbook not found: ${playbookName}`);
  }

  // Manual execution: Skip safety gates (operator override)
  logger.info(`[Remediation] Manual execution: ${playbookName}`);

  const execution: RemediationExecution = {
    id: generateUUID(),
    playbookName: playbook.name,
    triggeredBy,
    status: 'running',
    actions: playbook.actions.map(action => ({
      action,
      status: 'pending' as ExecutionStatus,
      startedAt: new Date().toISOString(),
    })),
    escalationLevel: 0,
    startedAt: startTime,
  };

  store.addExecution(execution);

  await executeActions(execution.actions, execution, config);

  execution.status = evaluateExecutionStatus(execution.actions);
  execution.completedAt = new Date().toISOString();

  if (execution.status === 'success') {
    store.recordSuccess(playbook.name);
  } else {
    store.recordFailure(playbook.name);
  }

  return execution;
}

// ============================================================
// Configuration & State Queries
// ============================================================

export function getRemediationConfig(): RemediationConfig {
  return store.getConfig();
}

export function updateRemediationConfig(updates: Partial<RemediationConfig>): RemediationConfig {
  return store.updateConfig(updates);
}

export function getExecutionHistory(limit: number = 20): RemediationExecution[] {
  return store.getExecutions(limit);
}

export function getCircuitBreakerStates(): CircuitBreakerState[] {
  return store.getCircuitStates();
}

export function resetCircuitBreaker(playbookName: string): void {
  store.resetCircuit(playbookName);
}
