import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGoalLearningEpisodes,
  listGoalLearningEpisodes,
  recordGoalLearningEpisode,
  suggestAutonomyPolicyFromEpisodes,
} from '@/lib/goal-learning';
import type { GoalLearningEpisode } from '@/types/goal-learning';

const episodes: GoalLearningEpisode[] = [];

vi.mock('@/lib/redis-store', () => ({
  getStore: () => ({
    addGoalLearningEpisode: async (episode: GoalLearningEpisode) => {
      episodes.unshift(episode);
    },
    listGoalLearningEpisodes: async (limit: number = 200) => episodes.slice(0, limit),
    clearGoalLearningEpisodes: async () => {
      episodes.length = 0;
    },
  }),
}));

vi.mock('@/lib/autonomy-policy', () => ({
  getRuntimeAutonomyPolicy: () => ({
    level: 'A3',
    minConfidenceDryRun: 0.35,
    minConfidenceWrite: 0.7,
  }),
}));

describe('goal-learning', () => {
  beforeEach(async () => {
    await clearGoalLearningEpisodes();
    vi.clearAllMocks();
  });

  it('should record and list learning episodes', async () => {
    await recordGoalLearningEpisode({
      timestamp: new Date().toISOString(),
      stage: 'selection',
      snapshotId: 'snapshot-1',
      candidateId: 'candidate-1',
      intent: 'stabilize',
      source: 'anomaly',
      risk: 'high',
      confidence: 0.8,
      outcome: 'queued',
    });

    const list = await listGoalLearningEpisodes(10);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBeDefined();
    expect(list[0].confidence).toBe(0.8);
  });

  it('should generate policy suggestion from episode history', async () => {
    await recordGoalLearningEpisode({
      timestamp: new Date().toISOString(),
      stage: 'execution',
      snapshotId: 'snapshot-1',
      goalId: 'goal-success-1',
      intent: 'stabilize',
      source: 'anomaly',
      risk: 'medium',
      confidence: 0.86,
      outcome: 'completed',
      verificationPassed: true,
    });
    await recordGoalLearningEpisode({
      timestamp: new Date().toISOString(),
      stage: 'execution',
      snapshotId: 'snapshot-1',
      goalId: 'goal-failed-1',
      intent: 'stabilize',
      source: 'anomaly',
      risk: 'high',
      confidence: 0.55,
      outcome: 'failed',
      verificationPassed: false,
    });

    const suggestion = await suggestAutonomyPolicyFromEpisodes(100);
    expect(suggestion.sampleSize).toBe(2);
    expect(suggestion.suggested.minConfidenceWrite).toBeGreaterThanOrEqual(0.4);
    expect(suggestion.suggested.minConfidenceWrite).toBeLessThanOrEqual(0.95);
    expect(suggestion.notes.length).toBeGreaterThan(0);
  });
});
