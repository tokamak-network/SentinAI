/**
 * Operation Control Types
 * Shared contracts for execution verification and rollback.
 */

export type OperationActionType =
  | 'scale_component'
  | 'restart_component'
  | 'restart_batcher'
  | 'restart_proposer'
  | 'switch_l1_rpc'
  | 'update_proxyd_backend'
  | 'goal_scale_execution'
  | 'goal_restart_execution'
  | 'agent_scaling';

export type OperationControlStatus =
  | 'verified'
  | 'rollback_succeeded'
  | 'rollback_failed'
  | 'verification_failed'
  | 'skipped';

export interface OperationVerificationResult {
  expected: string;
  observed: string;
  passed: boolean;
  details?: string;
  verifiedAt: string;
}

export interface RollbackPlan {
  available: boolean;
  actionType?: OperationActionType;
  params?: Record<string, unknown>;
  reason?: string;
}

export interface RollbackResult {
  attempted: boolean;
  success: boolean;
  message: string;
  executedAt: string;
  verification?: OperationVerificationResult;
}

export interface OperationControlResult {
  operationId: string;
  actionType: OperationActionType;
  status: OperationControlStatus;
  verification: OperationVerificationResult;
  rollback?: RollbackResult;
}

export interface OperationVerificationInput {
  actionType: OperationActionType;
  dryRun: boolean;
  expected: Record<string, unknown>;
  observed: Record<string, unknown>;
}
