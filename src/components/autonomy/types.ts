// src/components/autonomy/types.ts

// --- Pipeline Phase State Machine ---
export type PipelinePhase =
  | 'idle'
  | 'signal_collecting'
  | 'goal_generating'
  | 'goal_queued'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'rolling_back';

export type StageStatus =
  | 'idle'
  | 'waiting'
  | 'active'
  | 'executing'
  | 'success'
  | 'failed'
  | 'rollback';

export interface StageConfig {
  id: string;
  label: string;
  icon: string; // Lucide icon name
}

export interface GoalSummary {
  goalId: string;
  intent: string;
  confidence: number;
  risk: 'low' | 'medium' | 'high' | 'critical';
  goal: string;
}

export interface PlanSummary {
  planId: string;
  intent: string;
  stepCount: number;
  steps: Array<{ title: string; risk: string }>;
  generatedAt: string | null;
}

export interface ExecutionProgress {
  operationId: string;
  current: number;
  total: number;
  currentStep: string;
  success?: boolean;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
}

export interface VerificationResult {
  operationId: string;
  passed: number;
  total: number;
  status: 'pass' | 'fail';
  failedChecks: number;
  verifiedAt: string | null;
}

export interface RollbackProgress {
  operationId: string;
  current: number;
  total: number;
  success?: boolean;
  completedSteps: number;
  failedSteps: number;
}

export interface PipelineEvent {
  id: string;
  timestamp: string;
  phase: PipelinePhase;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

export interface PipelineState {
  phase: PipelinePhase;
  stageStatuses: Record<string, StageStatus>;
  currentGoal: GoalSummary | null;
  currentPlan: PlanSummary | null;
  executionProgress: ExecutionProgress | null;
  verificationResult: VerificationResult | null;
  rollbackProgress: RollbackProgress | null;
  history: PipelineEvent[];
}

// --- Shared types for hook/controls ---
export type AutonomousIntentData =
  | 'stabilize_throughput'
  | 'recover_sequencer_path'
  | 'reduce_cost_idle_window'
  | 'restore_l1_connectivity'
  | 'protect_critical_eoa';

export type AutonomyDemoAction =
  | 'seed-stable'
  | 'seed-rising'
  | 'seed-spike'
  | 'goal-tick'
  | 'goal-dispatch-dry-run'
  | 'autonomous-plan'
  | 'autonomous-execute'
  | 'autonomous-verify'
  | 'autonomous-rollback';

export type AutonomyLevel = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

export interface RuntimeAutonomyPolicyData {
  level: AutonomyLevel;
  minConfidenceDryRun: number;
  minConfidenceWrite: number;
}

export interface GoalManagerStatusData {
  config: {
    enabled: boolean;
    dispatchEnabled: boolean;
    llmEnhancerEnabled: boolean;
    dispatchDryRun: boolean;
    dispatchAllowWrites: boolean;
  };
  activeGoalId: string | null;
  queueDepth: number;
  queue: Array<{
    goalId: string;
    status: string;
    goal: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    score: { total: number };
  }>;
  dlq: Array<{ id: string; goalId: string; reason: string; attempts: number }>;
  suppression: Array<{ id: string; reasonCode: string; timestamp: string }>;
  lastTickSuppressedCount?: number;
}

// --- Pipeline stage definitions ---
export const PIPELINE_STAGES: StageConfig[] = [
  { id: 'signal', label: 'Signal', icon: 'Radio' },
  { id: 'goal', label: 'Goal', icon: 'Target' },
  { id: 'plan', label: 'Plan', icon: 'ClipboardList' },
  { id: 'act', label: 'Act', icon: 'Play' },
  { id: 'verify', label: 'Verify', icon: 'ShieldCheck' },
];

// Phase -> which stages are active/executing/etc.
export const PHASE_STAGE_MAP: Record<PipelinePhase, Record<string, StageStatus>> = {
  idle:               { signal: 'waiting', goal: 'idle', plan: 'idle', act: 'idle', verify: 'idle' },
  signal_collecting:  { signal: 'active', goal: 'idle', plan: 'idle', act: 'idle', verify: 'idle' },
  goal_generating:    { signal: 'success', goal: 'active', plan: 'idle', act: 'idle', verify: 'idle' },
  goal_queued:        { signal: 'success', goal: 'success', plan: 'waiting', act: 'idle', verify: 'idle' },
  planning:           { signal: 'success', goal: 'success', plan: 'executing', act: 'idle', verify: 'idle' },
  executing:          { signal: 'success', goal: 'success', plan: 'success', act: 'executing', verify: 'idle' },
  verifying:          { signal: 'success', goal: 'success', plan: 'success', act: 'success', verify: 'executing' },
  completed:          { signal: 'success', goal: 'success', plan: 'success', act: 'success', verify: 'success' },
  failed:             { signal: 'success', goal: 'success', plan: 'success', act: 'failed', verify: 'idle' },
  rolling_back:       { signal: 'success', goal: 'success', plan: 'rollback', act: 'rollback', verify: 'failed' },
};

// Stage glow colors per status
export const STAGE_GLOW_COLORS: Record<StageStatus, string> = {
  idle: 'transparent',
  waiting: 'rgba(59, 130, 246, 0.3)',    // blue
  active: 'rgba(6, 182, 212, 0.5)',      // cyan
  executing: 'rgba(34, 197, 94, 0.6)',   // green
  success: 'rgba(34, 197, 94, 0.4)',     // green (dimmer)
  failed: 'rgba(239, 68, 68, 0.6)',      // red
  rollback: 'rgba(249, 115, 22, 0.5)',   // orange
};

// Intent options for the controls dropdown
export const AUTONOMOUS_INTENT_OPTIONS: Array<{ value: AutonomousIntentData; label: string }> = [
  { value: 'stabilize_throughput', label: 'Stabilize Throughput' },
  { value: 'recover_sequencer_path', label: 'Recover Sequencer' },
  { value: 'reduce_cost_idle_window', label: 'Reduce Cost' },
  { value: 'restore_l1_connectivity', label: 'Restore L1' },
  { value: 'protect_critical_eoa', label: 'Protect EOA' },
];

// Seed scenario -> suggested autonomous intent mapping
export const SEED_INTENT_MAP: Record<string, AutonomousIntentData> = {
  spike: 'stabilize_throughput',
  rising: 'reduce_cost_idle_window',
  stable: 'protect_critical_eoa',
  falling: 'recover_sequencer_path',
};

// All autonomy levels
export const AUTONOMY_LEVELS: AutonomyLevel[] = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
