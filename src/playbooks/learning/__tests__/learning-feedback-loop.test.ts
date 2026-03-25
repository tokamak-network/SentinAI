import { describe, expect, it } from 'vitest';
import { applyOutcomeFeedback } from '@/playbooks/learning/learning-feedback-loop';
import { generatePlaybookFromPattern } from '@/playbooks/learning/playbook-generator';
import type { IncidentPattern } from '@/playbooks/learning/types';

function makePattern(): IncidentPattern {
  return {
    triggerSignature: 'z-score|txPoolPending|z:3.0|v:120',
    action: 'restart-batcher',
    occurrences: 5,
    successRate: 0.8,
    avgResolutionMs: 10000,
    samples: [
      {
        operationId: 'op-1',
        instanceId: 'inst-a',
        timestamp: '2026-02-28T00:00:00.000Z',
        trigger: {
          anomalyType: 'z-score',
          metricName: 'txPoolPending',
          metricValue: 120,
          zScore: 3.2,
        },
        playbookId: null,
        action: 'restart-batcher',
        outcome: 'success',
        resolutionMs: 10000,
        verificationPassed: true,
      },
    ],
  };
}

describe('learning feedback loop', () => {
  it('updates confidence and performance on success outcome', () => {
    const base = generatePlaybookFromPattern({
      instanceId: 'inst-a',
      pattern: makePattern(),
      now: new Date('2026-02-28T00:00:00.000Z'),
    });

    const evaluated = applyOutcomeFeedback({
      playbook: base,
      outcome: 'success',
      resolutionMs: 8000,
      appliedAt: '2026-02-28T01:00:00.000Z',
    });

    expect(evaluated.playbook.confidence).toBeGreaterThan(base.confidence);
    expect(evaluated.playbook.performance.totalApplications).toBe(base.performance.totalApplications + 1);
    expect(evaluated.playbook.performance.lastOutcome).toBe('success');
  });

  it('suspends playbook after 5 consecutive failures', () => {
    let playbook = generatePlaybookFromPattern({
      instanceId: 'inst-a',
      pattern: makePattern(),
      now: new Date('2026-02-20T00:00:00.000Z'),
    });

    for (let i = 0; i < 5; i++) {
      const result = applyOutcomeFeedback({
        playbook,
        outcome: 'failure',
        resolutionMs: 15000,
        appliedAt: `2026-02-2${i}T00:00:00.000Z`,
      });
      playbook = result.playbook;
    }

    expect(playbook.reviewStatus).toBe('suspended');
    expect(playbook.evolution.changelog.at(-1)?.reason).toContain('Auto-suspended');
  });

  it('archives when low confidence and inactive for >= 7 days', () => {
    const base = generatePlaybookFromPattern({
      instanceId: 'inst-a',
      pattern: makePattern(),
      now: new Date('2026-02-01T00:00:00.000Z'),
    });

    const lowConfidence = {
      ...base,
      confidence: 0.25,
      reviewStatus: 'draft' as const,
      performance: {
        ...base.performance,
        lastApplied: '2026-02-01T00:00:00.000Z',
      },
    };

    const result = applyOutcomeFeedback({
      playbook: lowConfidence,
      outcome: 'partial',
      resolutionMs: 12000,
      appliedAt: '2026-02-10T00:00:00.000Z',
    });

    expect(result.shouldArchive).toBe(true);
    expect(result.playbook.reviewStatus).toBe('archived');
  });
});
