/**
 * Goal Planner Types
 * Natural-language goal decomposition and guarded execution contract.
 */

export type GoalPlanIntent =
  | 'stabilize'
  | 'cost-optimize'
  | 'investigate'
  | 'recover'
  | 'custom';

export type GoalPlanStatus =
  | 'planned'
  | 'running'
  | 'completed'
  | 'failed';

export type GoalPlanStepStatus =
  | 'pending'
  | 'completed'
  | 'skipped'
  | 'failed';

export type GoalPlanStepAction =
  | 'collect_state'
  | 'inspect_anomalies'
  | 'run_rca'
  | 'scale_execution'
  | 'restart_execution'
  | 'set_routing_policy';

export interface GoalPlanStep {
  id: string;
  title: string;
  action: GoalPlanStepAction;
  reason: string;
  risk: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  parameters?: Record<string, unknown>;
  preconditions?: string[];
  rollbackHint?: string;
  status: GoalPlanStepStatus;
  resultSummary?: string;
}

export interface GoalPlan {
  planId: string;
  goal: string;
  intent: GoalPlanIntent;
  status: GoalPlanStatus;
  dryRun: boolean;
  createdAt: string;
  updatedAt: string;
  summary: string;
  steps: GoalPlanStep[];
}

export interface GoalExecutionOptions {
  dryRun: boolean;
  allowWrites: boolean;
  initiatedBy: 'api' | 'mcp' | 'scheduler';
}

export interface GoalExecutionResult {
  plan: GoalPlan;
  executionLog: Array<{
    stepId: string;
    action: GoalPlanStepAction;
    status: GoalPlanStepStatus;
    message: string;
    executedAt: string;
  }>;
}

