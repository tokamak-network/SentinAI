/**
 * Autonomous Operations Types
 * Shared contracts for chain-aware autonomous planning/execution/verification.
 */

export type AutonomousIntent =
  | 'stabilize_throughput'
  | 'recover_sequencer_path'
  | 'reduce_cost_idle_window'
  | 'restore_l1_connectivity'
  | 'protect_critical_eoa';

export type AutonomousAction =
  | 'collect_metrics'
  | 'inspect_anomalies'
  | 'run_rca'
  | 'scale_execution'
  | 'scale_sequencer'
  | 'scale_core_execution'
  | 'restart_execution'
  | 'restart_batcher'
  | 'restart_proposer'
  | 'restart_batch_poster'
  | 'restart_validator'
  | 'restart_prover'
  | 'restart_batcher_pipeline'
  | 'switch_l1_rpc'
  | 'set_routing_policy'
  | 'verify_block_progress'
  | 'verify_component_recovered'
  | 'verify_settlement_lag';

export type AutonomousRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type AutonomousRuntime = 'k8s' | 'docker';

export interface AutonomousExecutionContext {
  chainType: string;
  runtime: AutonomousRuntime;
  dryRun: boolean;
  allowWrites: boolean;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface AutonomousPlanStep {
  id: string;
  intent: AutonomousIntent;
  action: AutonomousAction;
  title: string;
  reason: string;
  risk: AutonomousRiskLevel;
  requiresApproval: boolean;
  targetComponent?: string;
  resourceTarget?: {
    vcpu?: number;
    memoryGiB?: number;
  };
  safetyChecks?: string[];
  verificationChecks?: string[];
  rollbackHint?: string;
  params?: Record<string, unknown>;
}

export interface AutonomousPlan {
  planId: string;
  chainType: string;
  intent: AutonomousIntent;
  dryRun: boolean;
  generatedAt: string;
  summary: string;
  steps: AutonomousPlanStep[];
}

export interface AutonomousActionPolicy {
  chainType: string;
  action: AutonomousAction;
  risk: AutonomousRiskLevel;
  requiresApproval: boolean;
  allowAutoExecute: boolean;
  cooldownSeconds?: number;
}

export interface AutonomousVerificationResult {
  stepId: string;
  action: AutonomousAction;
  passed: boolean;
  checks: Array<{
    check: string;
    passed: boolean;
    details?: string;
  }>;
  summary: string;
  verifiedAt: string;
}

export interface AutonomousExecutionResult {
  operationId: string;
  chainType: string;
  intent: AutonomousIntent;
  dryRun: boolean;
  success: boolean;
  steps: Array<{
    stepId: string;
    action: AutonomousAction;
    status: 'completed' | 'failed' | 'skipped';
    message: string;
    output?: Record<string, unknown>;
    verification?: AutonomousVerificationResult;
  }>;
  startedAt: string;
  completedAt: string;
}

export interface AutonomousCapabilities {
  chainType: string;
  intents: AutonomousIntent[];
  actions: AutonomousAction[];
  policies: AutonomousActionPolicy[];
}
