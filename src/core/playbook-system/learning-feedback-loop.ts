import type { EvolvedPlaybook, LedgerOutcome, PlaybookReviewStatus } from '@/core/playbook-system/types';

export interface FeedbackEvaluation {
  playbook: EvolvedPlaybook;
  statusChanged: boolean;
  shouldSuspend: boolean;
  shouldArchive: boolean;
  reason: string;
}

const OUTCOME_DELTA: Record<LedgerOutcome, number> = {
  success: 0.05,
  failure: -0.2,
  partial: 0.01,
  timeout: -0.1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function inferStatus(confidence: number): PlaybookReviewStatus {
  if (confidence < 0.4) return 'draft';
  if (confidence < 0.7) return 'pending';
  if (confidence < 0.9) return 'approved';
  return 'trusted';
}

function toMs(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function countRecentConsecutiveFailures(playbook: EvolvedPlaybook): number {
  let count = 0;

  for (let i = playbook.evolution.changelog.length - 1; i >= 0; i--) {
    const entry = playbook.evolution.changelog[i];
    if (!entry.reason.startsWith('Outcome:')) continue;
    if (entry.reason.includes('Outcome: failure')) {
      count += 1;
      continue;
    }
    break;
  }

  return count;
}

export function applyOutcomeFeedback(input: {
  playbook: EvolvedPlaybook;
  outcome: LedgerOutcome;
  resolutionMs: number;
  appliedAt?: string;
}): FeedbackEvaluation {
  const appliedAt = input.appliedAt ?? new Date().toISOString();
  const delta = OUTCOME_DELTA[input.outcome] ?? 0;
  const prevStatus = input.playbook.reviewStatus;
  const prevConfidence = input.playbook.confidence;
  const confidence = clamp(prevConfidence + delta, 0, 1);

  const nextTotal = input.playbook.performance.totalApplications + 1;
  const prevSuccesses = input.playbook.performance.successRate * input.playbook.performance.totalApplications;
  const nextSuccesses = prevSuccesses + (input.outcome === 'success' ? 1 : 0);
  const successRate = nextTotal > 0 ? nextSuccesses / nextTotal : 0;

  const weightedResolutionMs =
    input.playbook.performance.avgResolutionMs * input.playbook.performance.totalApplications + input.resolutionMs;
  const avgResolutionMs = nextTotal > 0 ? weightedResolutionMs / nextTotal : input.resolutionMs;

  const nextVersion = input.playbook.evolution.version + 1;
  const nextStatus = inferStatus(confidence);

  let shouldSuspend = false;
  let shouldArchive = false;
  let reason = `Outcome: ${input.outcome}`;

  const provisional: EvolvedPlaybook = {
    ...input.playbook,
    confidence,
    reviewStatus: nextStatus,
    performance: {
      totalApplications: nextTotal,
      successRate,
      avgResolutionMs,
      lastApplied: appliedAt,
      lastOutcome: input.outcome,
    },
    evolution: {
      version: nextVersion,
      changelog: [
        ...input.playbook.evolution.changelog,
        {
          version: nextVersion,
          timestamp: appliedAt,
          reason,
          confidenceDelta: delta,
          changedBy: 'system',
        },
      ],
    },
  };

  const failureStreak = countRecentConsecutiveFailures(provisional);
  if (failureStreak >= 5) {
    provisional.reviewStatus = 'suspended';
    shouldSuspend = true;
    reason = 'Auto-suspended after 5 consecutive failures';
  }

  const idleDays = (toMs(appliedAt) - toMs(input.playbook.performance.lastApplied)) / (24 * 60 * 60 * 1000);
  if (provisional.confidence < 0.3 && idleDays >= 7) {
    provisional.reviewStatus = 'archived';
    shouldArchive = true;
    reason = 'Archived due to low confidence and inactivity window';
  }

  if (shouldSuspend || shouldArchive) {
    provisional.evolution.version += 1;
    provisional.evolution.changelog.push({
      version: provisional.evolution.version,
      timestamp: appliedAt,
      reason,
      confidenceDelta: 0,
      changedBy: 'system',
    });
  }

  return {
    playbook: provisional,
    statusChanged: prevStatus !== provisional.reviewStatus,
    shouldSuspend,
    shouldArchive,
    reason,
  };
}
