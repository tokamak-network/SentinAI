/**
 * Goal Learning Module
 * Episode recording and offline policy suggestion utilities.
 */

import { randomUUID } from 'crypto';
import { getRuntimeAutonomyPolicy } from '@/lib/autonomy-policy';
import { getStore } from '@/lib/redis-store';
import type {
  GoalLearningEpisode,
  GoalLearningPolicySuggestion,
} from '@/types/goal-learning';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function recordGoalLearningEpisode(
  episode: Omit<GoalLearningEpisode, 'id'>
): Promise<void> {
  const normalized: GoalLearningEpisode = {
    id: randomUUID(),
    ...episode,
    confidence: clamp(episode.confidence, 0, 1),
  };
  await getStore().addGoalLearningEpisode(normalized);
}

export async function listGoalLearningEpisodes(limit: number = 500): Promise<GoalLearningEpisode[]> {
  return getStore().listGoalLearningEpisodes(limit);
}

export async function clearGoalLearningEpisodes(): Promise<void> {
  await getStore().clearGoalLearningEpisodes();
}

function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = clamp(Math.floor((sortedValues.length - 1) * percentile), 0, sortedValues.length - 1);
  return sortedValues[idx];
}

export async function suggestAutonomyPolicyFromEpisodes(limit: number = 1000): Promise<GoalLearningPolicySuggestion> {
  const episodes = await listGoalLearningEpisodes(limit);
  const current = getRuntimeAutonomyPolicy();

  const completedWrites = episodes.filter((episode) => (
    episode.stage === 'execution' &&
    episode.outcome === 'completed' &&
    episode.verificationPassed !== false &&
    episode.confidence > 0
  ));

  const failedWrites = episodes.filter((episode) => (
    episode.stage === 'execution' &&
    (episode.outcome === 'failed' || episode.outcome === 'dlq') &&
    episode.confidence > 0
  ));

  const completedConfidences = completedWrites.map((episode) => episode.confidence).sort((a, b) => a - b);
  const failedConfidences = failedWrites.map((episode) => episode.confidence).sort((a, b) => a - b);

  const highFailureBand = calculatePercentile(failedConfidences, 0.8);
  const highSuccessBand = calculatePercentile(completedConfidences, 0.2);

  const suggestedWrite = clamp(
    (highFailureBand + highSuccessBand) / (failedConfidences.length > 0 ? 2 : 1) || current.minConfidenceWrite,
    0.4,
    0.95
  );
  const suggestedDryRun = clamp(suggestedWrite - 0.2, 0.2, 0.85);

  const sampleSize = episodes.length;
  const confidence = clamp(sampleSize / 500, 0, 1);

  const notes: string[] = [];
  notes.push(`episodes=${sampleSize}`);
  notes.push(`completedWrites=${completedWrites.length}`);
  notes.push(`failedWrites=${failedWrites.length}`);
  if (failedWrites.length === 0) {
    notes.push('no failed write samples; suggestion is conservative');
  }
  if (sampleSize < 100) {
    notes.push('sample size is small; review manually before applying');
  }

  return {
    generatedAt: new Date().toISOString(),
    sampleSize,
    current: {
      minConfidenceWrite: current.minConfidenceWrite,
      minConfidenceDryRun: current.minConfidenceDryRun,
    },
    suggested: {
      minConfidenceWrite: Number(suggestedWrite.toFixed(3)),
      minConfidenceDryRun: Number(suggestedDryRun.toFixed(3)),
    },
    confidence: Number(confidence.toFixed(3)),
    notes,
  };
}
