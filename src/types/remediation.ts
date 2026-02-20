/**
 * Auto-Remediation Engine Type Definitions
 */

// ============================================================
// RCA Component Type (re-exported from rca.ts)
// ============================================================

import type { RCAComponent } from './rca';
export type { RCAComponent };

// ============================================================
// Action Types
// ============================================================

/** Safety classification for remediation actions */
export type SafetyLevel = 'safe' | 'guarded' | 'manual';

/** Predefined remediation action types */
export type RemediationActionType =
  // Safe
  | 'collect_logs'
  | 'health_check'
  | 'check_l1_connection'
  | 'describe_pod'
  | 'check_treasury_balance'
  | 'check_l1_gas_price'
  | 'verify_balance_restored'
  | 'escalate_operator'
  // Guarded
  | 'restart_pod'
  | 'scale_up'
  | 'scale_down'
  | 'zero_downtime_swap'
  | 'refill_eoa'
  | 'claim_bond'
  // Manual
  | 'config_change'
  | 'rollback_deployment'
  | 'force_restart_all';

/** Single remediation action */
export interface RemediationAction {
  type: RemediationActionType;
  safetyLevel: SafetyLevel;
  target?: RCAComponent;
  params?: Record<string, unknown>;
  /** Wait time after execution (ms) */
  waitAfterMs?: number;
}

// ============================================================
// Playbook Types
// ============================================================

/** Trigger condition indicator */
export interface PlaybookIndicator {
  type: 'metric' | 'log_pattern';
  /** Metric condition (e.g., "cpuPercent > 90") or log regex pattern */
  condition: string;
}

/** Trigger condition definition */
export interface PlaybookTrigger {
  component: RCAComponent;
  indicators: PlaybookIndicator[];
}

/** Playbook definition */
export interface Playbook {
  name: string;
  description: string;
  trigger: PlaybookTrigger;
  actions: RemediationAction[];
  fallback?: RemediationAction[];
  /** Maximum attempts before escalation */
  maxAttempts: number;
}

// ============================================================
// Execution Types
// ============================================================

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'escalated';

/** Single action execution result */
export interface ActionResult {
  action: RemediationAction;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  output?: string;
  error?: string;
}

/** Playbook execution record */
export interface RemediationExecution {
  id: string;
  playbookName: string;
  triggeredBy: 'auto' | 'manual';
  anomalyEventId?: string;
  status: ExecutionStatus;
  actions: ActionResult[];
  escalationLevel: number;
  startedAt: string;
  completedAt?: string;
}

// ============================================================
// Escalation Types
// ============================================================

export type EscalationLevel = 0 | 1 | 2 | 3;

export interface EscalationState {
  level: EscalationLevel;
  /** Operator response wait start time (Level 2+) */
  awaitingSince?: string;
  /** Operator acknowledgment status */
  acknowledged: boolean;
}

// ============================================================
// Configuration Types
// ============================================================

export interface RemediationConfig {
  enabled: boolean;
  /** Allow Guarded actions to execute automatically */
  allowGuardedActions: boolean;
  cooldownMinutes: number;
  maxExecutionsPerHour: number;
  maxExecutionsPerDay: number;
  /** Maximum vCPU for auto scale-up */
  maxAutoScaleVcpu: number;
  /** Circuit breaker: consecutive failure threshold */
  circuitBreakerThreshold: number;
}

/** Circuit Breaker state */
export interface CircuitBreakerState {
  playbookName: string;
  consecutiveFailures: number;
  isOpen: boolean;
  openedAt?: string;
  /** Reset time (when breaker closes) */
  resetAt?: string;
}
