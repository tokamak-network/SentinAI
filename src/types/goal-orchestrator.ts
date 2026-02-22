/**
 * Goal Orchestrator Types
 * Durable queue execution contracts for leases, checkpoints, retries, and DLQ.
 */

import type { AutonomousGoalQueueItem } from '@/types/goal-manager';

export type GoalExecutionPhase =
  | 'scheduled'
  | 'lease_acquired'
  | 'policy_check'
  | 'plan_started'
  | 'plan_completed'
  | 'verify_completed'
  | 'rollback_completed'
  | 'failed'
  | 'requeued'
  | 'dlq';

export interface GoalLeaseRecord {
  goalId: string;
  ownerId: string;
  leasedAt: string;
  leaseExpiresAt: string;
  heartbeatAt: string;
  version: number;
}

export interface GoalExecutionCheckpoint {
  goalId: string;
  phase: GoalExecutionPhase;
  timestamp: string;
  details?: string;
  metadata?: Record<string, unknown>;
}

export interface GoalIdempotencyRecord {
  key: string;
  goalId: string;
  createdAt: string;
  expiresAt: string;
  ownerId: string;
}

export interface GoalDlqItem {
  id: string;
  goalId: string;
  movedAt: string;
  reason: string;
  attempts: number;
  lastError?: string;
  queueItem: AutonomousGoalQueueItem;
}

export interface GoalRetryPolicy {
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}
