/**
 * Autonomous Goal Manager Types
 * Phase A foundation types for autonomous goal generation and queue lifecycle.
 */

import type { GoalPlanIntent } from '@/types/goal-planner';

export type AutonomousGoalSource =
  | 'metrics'
  | 'anomaly'
  | 'policy'
  | 'cost'
  | 'failover'
  | 'memory';

export type AutonomousGoalStatus =
  | 'candidate'
  | 'queued'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'failed'
  | 'dlq'
  | 'suppressed'
  | 'expired';

export type AutonomousGoalRisk = 'low' | 'medium' | 'high' | 'critical';

export type GoalSuppressionReasonCode =
  | 'duplicate_goal'
  | 'low_confidence'
  | 'policy_blocked'
  | 'cooldown_active'
  | 'stale_signal';

export type GoalSignalTrend = 'rising' | 'falling' | 'stable';

export interface GoalPriorityScore {
  impact: number;      // 0-40
  urgency: number;     // 0-25
  confidence: number;  // 0-20
  policyFit: number;   // 0-15
  total: number;       // 0-100
}

export interface GoalMetricsSignal {
  latestCpuUsage: number | null;
  latestTxPoolPending: number | null;
  latestGasUsedRatio: number | null;
  currentVcpu: number;
  cooldownRemaining: number;
  cpuTrend: GoalSignalTrend;
  txPoolTrend: GoalSignalTrend;
  gasTrend: GoalSignalTrend;
}

export interface GoalAnomalySignal {
  activeCount: number;
  criticalCount: number;
  latestEventTimestamp: string | null;
}

export interface GoalFailoverSignal {
  recentCount: number;
  latestEventTimestamp: string | null;
  activeL1RpcUrl: string;
}

export interface GoalCostSignal {
  avgVcpu: number;
  peakVcpu: number;
  avgUtilization: number;
  dataPointCount: number;
}

export interface GoalMemorySignal {
  recentEntryCount: number;
  recentIncidentCount: number;
  recentHighSeverityCount: number;
  latestEntryTimestamp: string | null;
}

export interface GoalPolicySignal {
  readOnlyMode: boolean;
  autoScalingEnabled: boolean;
}

export interface GoalSignalSnapshot {
  snapshotId: string;
  collectedAt: string;
  chainType: string;
  sources: AutonomousGoalSource[];
  metrics: GoalMetricsSignal;
  anomalies: GoalAnomalySignal;
  failover: GoalFailoverSignal;
  cost: GoalCostSignal;
  memory: GoalMemorySignal;
  policy: GoalPolicySignal;
}

export interface AutonomousGoalCandidate {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: AutonomousGoalSource;
  status: Extract<AutonomousGoalStatus, 'candidate' | 'queued' | 'suppressed'>;
  goal: string;
  intent: GoalPlanIntent;
  risk: AutonomousGoalRisk;
  confidence: number; // 0-1
  signature: string;  // dedup key
  rationale: string;
  signalSnapshotId: string;
  score?: GoalPriorityScore;
  suppressionReasonCode?: GoalSuppressionReasonCode;
  metadata?: Record<string, unknown>;
}

export interface AutonomousGoalQueueItem {
  goalId: string;
  candidateId: string;
  enqueuedAt: string;
  scheduledAt?: string;
  nextAttemptAt?: string;
  startedAt?: string;
  finishedAt?: string;
  expiresAt?: string;
  attempts: number;
  status: Exclude<AutonomousGoalStatus, 'candidate' | 'suppressed'>;
  goal: string;
  intent: GoalPlanIntent;
  source: AutonomousGoalSource;
  risk: AutonomousGoalRisk;
  confidence: number;
  signature: string;
  score: GoalPriorityScore;
  lastError?: string;
  planId?: string;
  idempotencyKey?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface GoalSuppressionRecord {
  id: string;
  timestamp: string;
  candidateId: string;
  signature: string;
  source: AutonomousGoalSource;
  risk: AutonomousGoalRisk;
  reasonCode: GoalSuppressionReasonCode;
  details?: string;
}
