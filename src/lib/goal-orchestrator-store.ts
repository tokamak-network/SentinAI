/**
 * Goal Orchestrator Store — Domain Facade
 *
 * Scoped access to Autonomous Goal Manager methods from the unified state store.
 * Isolates goal orchestration state from the monolithic IStateStore.
 *
 * Usage:
 *   import { getGoalOrchestratorStore } from '@/lib/goal-orchestrator-store';
 *   const store = getGoalOrchestratorStore();
 *   await store.addAutonomousGoalCandidate(candidate);
 */

import { getStore } from '@/lib/redis-store';
import type {
  AutonomousGoalCandidate,
  AutonomousGoalQueueItem,
  GoalSuppressionRecord,
} from '@/types/goal-manager';
import type {
  GoalDlqItem,
  GoalExecutionCheckpoint,
  GoalIdempotencyRecord,
  GoalLeaseRecord,
} from '@/types/goal-orchestrator';
import type { GoalLearningEpisode } from '@/types/goal-learning';

export interface IGoalOrchestratorStore {
  addAutonomousGoalCandidate(candidate: AutonomousGoalCandidate): Promise<void>;
  listAutonomousGoalCandidates(limit?: number): Promise<AutonomousGoalCandidate[]>;
  clearAutonomousGoalCandidates(): Promise<void>;

  upsertAutonomousGoalQueueItem(item: AutonomousGoalQueueItem): Promise<void>;
  getAutonomousGoalQueue(limit?: number): Promise<AutonomousGoalQueueItem[]>;
  getAutonomousGoalQueueItem(goalId: string): Promise<AutonomousGoalQueueItem | null>;
  removeAutonomousGoalQueueItem(goalId: string): Promise<void>;
  clearAutonomousGoalQueue(): Promise<void>;

  getActiveAutonomousGoalId(): Promise<string | null>;
  setActiveAutonomousGoalId(goalId: string | null): Promise<void>;

  addGoalSuppressionRecord(record: GoalSuppressionRecord): Promise<void>;
  listGoalSuppressionRecords(limit?: number): Promise<GoalSuppressionRecord[]>;
  clearGoalSuppressionRecords(): Promise<void>;

  getGoalLease(goalId: string): Promise<GoalLeaseRecord | null>;
  setGoalLease(goalId: string, lease: GoalLeaseRecord): Promise<void>;
  clearGoalLease(goalId: string): Promise<void>;

  getGoalCheckpoint(goalId: string): Promise<GoalExecutionCheckpoint | null>;
  setGoalCheckpoint(goalId: string, checkpoint: GoalExecutionCheckpoint): Promise<void>;
  clearGoalCheckpoint(goalId: string): Promise<void>;

  addGoalDlqItem(item: GoalDlqItem): Promise<void>;
  listGoalDlqItems(limit?: number): Promise<GoalDlqItem[]>;
  removeGoalDlqItem(goalId: string): Promise<void>;
  clearGoalDlqItems(): Promise<void>;

  registerGoalIdempotency(record: GoalIdempotencyRecord): Promise<boolean>;
  getGoalIdempotency(key: string): Promise<GoalIdempotencyRecord | null>;
  clearGoalIdempotency(key: string): Promise<void>;

  addGoalLearningEpisode(episode: GoalLearningEpisode): Promise<void>;
  listGoalLearningEpisodes(limit?: number): Promise<GoalLearningEpisode[]>;
  clearGoalLearningEpisodes(): Promise<void>;
}

/**
 * Returns the goal orchestrator facade backed by the configured state store.
 * All methods are part of IStateStore — no cast required.
 */
export function getGoalOrchestratorStore(): IGoalOrchestratorStore {
  return getStore();
}
