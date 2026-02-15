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
} from '@/types/remediation';
import { matchPlaybook, getPlaybookByName } from '@/lib/playbook-matcher';
import { executeAction } from '@/lib/action-executor';
import * as store from '@/lib/remediation-store';
import { DEFAULT_SCALING_CONFIG } from '@/types/scaling';

// ============================================================
// UUID Generator
// ============================================================

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
      
      console.log(`[Remediation] Action ${action.type}: ${result.status}`);

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
        console.error(`[Remediation] Critical action failed: ${action.type}`);
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

  console.log(`[Remediation] Triggered for event ${event.id}`);

  // 1. Match playbook
  const playbook = matchPlaybook(event, analysis);

  if (!playbook) {
    console.log('[Remediation] No matching playbook found');
    
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

  console.log(`[Remediation] Matched playbook: ${playbook.name}`);

  // 2. Safety gate checks
  const safetyCheck = await checkSafetyGates(playbook.name, config);

  if (!safetyCheck.allowed) {
    console.log(`[Remediation] Blocked: ${safetyCheck.reason}`);
    
    const execution: RemediationExecution = {
      id: generateUUID(),
      playbookName: playbook.name,
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
    playbookName: playbook.name,
    triggeredBy: 'auto',
    anomalyEventId: event.id,
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
  store.setLastExecutionTime(playbook.name, Date.now());

  // 4. Execute actions
  await executeActions(execution.actions, execution, config);

  // 5. Evaluate result
  execution.status = evaluateExecutionStatus(execution.actions);
  execution.completedAt = new Date().toISOString();

  if (execution.status === 'success') {
    store.recordSuccess(playbook.name);
    console.log(`[Remediation] ✅ Success: ${playbook.name}`);
  } else if (execution.status === 'failed') {
    store.recordFailure(playbook.name);
    console.log(`[Remediation] ❌ Failed: ${playbook.name}`);

    // Try fallback actions if available
    if (playbook.fallback && playbook.fallback.length > 0) {
      console.log('[Remediation] Attempting fallback actions...');
      
      const fallbackResults: ActionResult[] = playbook.fallback.map(action => ({
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
        console.log('[Remediation] ✅ Fallback succeeded');
      } else {
        execution.escalationLevel = 1;
        console.log('[Remediation] ⚠️ Fallback also failed, escalating...');
      }
    } else {
      execution.escalationLevel = 1;
    }
  }

  return execution;
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
  console.log(`[Remediation] Manual execution: ${playbookName}`);

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
