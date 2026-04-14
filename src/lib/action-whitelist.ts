/**
 * Action Whitelist
 * Central registry of allowed goal-plan step actions.
 *
 * Why: ALLOWED_ACTIONS lived only in goal-plan-validator, so callers outside
 * the goal-plan path (e.g., NLOps, MCP tools) could not enforce the same
 * policy. This module is the single source of truth.
 */

import type { GoalPlanStepAction } from '@/types/goal-planner';

// ============================================================
// Whitelist
// ============================================================

export const ALLOWED_GOAL_PLAN_ACTIONS: readonly GoalPlanStepAction[] = [
  'collect_state',
  'inspect_anomalies',
  'run_rca',
  'scale_execution',
  'restart_execution',
  'set_routing_policy',
] as const;

// ============================================================
// Error
// ============================================================

export class WhitelistViolationError extends Error {
  readonly action: string;
  readonly context: string;

  constructor(action: string, context = 'unknown') {
    super(`Action '${action}' is not in the allowed actions whitelist (context: ${context})`);
    this.name = 'WhitelistViolationError';
    this.action = action;
    this.context = context;
  }
}

// ============================================================
// Guard
// ============================================================

/**
 * Check whether a goal-plan action is whitelisted.
 * Returns true if allowed, false if not (non-throwing variant).
 */
export function isGoalPlanActionAllowed(action: string): action is GoalPlanStepAction {
  return (ALLOWED_GOAL_PLAN_ACTIONS as readonly string[]).includes(action);
}

/**
 * Assert that a goal-plan action is whitelisted.
 * Throws WhitelistViolationError if not.
 * Callers should catch this and record to the autonomy ledger if desired.
 */
export function assertGoalPlanActionAllowed(action: string, context = 'unknown'): asserts action is GoalPlanStepAction {
  if (!isGoalPlanActionAllowed(action)) {
    throw new WhitelistViolationError(action, context);
  }
}
