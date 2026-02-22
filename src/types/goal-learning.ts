/**
 * Goal Learning Types
 * Episodic records for offline policy tuning and replay analysis.
 */

import type {
  AutonomousGoalRisk,
  AutonomousGoalSource,
  GoalSuppressionReasonCode,
} from '@/types/goal-manager';
import type { GoalPlanIntent } from '@/types/goal-planner';

export type GoalEpisodeStage = 'selection' | 'execution';

export type GoalEpisodeOutcome =
  | 'queued'
  | 'suppressed'
  | 'completed'
  | 'failed'
  | 'requeued'
  | 'dlq';

export interface GoalLearningEpisode {
  id: string;
  timestamp: string;
  stage: GoalEpisodeStage;
  snapshotId: string;
  goalId?: string;
  candidateId?: string;
  intent: GoalPlanIntent;
  source: AutonomousGoalSource;
  risk: AutonomousGoalRisk;
  confidence: number;
  scoreTotal?: number;
  suppressionReasonCode?: GoalSuppressionReasonCode;
  outcome: GoalEpisodeOutcome;
  verificationPassed?: boolean;
  rollbackTriggered?: boolean;
  rollbackSucceeded?: boolean;
  executionLatencyMs?: number;
  metadata?: Record<string, unknown>;
}

export interface GoalLearningPolicySuggestion {
  generatedAt: string;
  sampleSize: number;
  current: {
    minConfidenceWrite: number;
    minConfidenceDryRun: number;
  };
  suggested: {
    minConfidenceWrite: number;
    minConfidenceDryRun: number;
  };
  confidence: number;
  notes: string[];
}
