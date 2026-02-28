import { describe, expect, it } from 'vitest';
import { generatePlaybookFromPattern, mergePatternIntoPlaybook } from '@/core/playbook-system/playbook-generator';
import type { IncidentPattern, OperationRecord } from '@/core/playbook-system/types';

function makeSample(outcome: OperationRecord['outcome'], timestamp: string): OperationRecord {
  return {
    operationId: `op-${timestamp}`,
    instanceId: 'inst-a',
    timestamp,
    trigger: {
      anomalyType: 'z-score',
      metricName: 'txPoolPending',
      metricValue: 120,
      zScore: 3.2,
    },
    playbookId: null,
    action: 'restart-batcher',
    outcome,
    resolutionMs: 15000,
    verificationPassed: outcome !== 'failure',
  };
}

function makePattern(overrides: Partial<IncidentPattern> = {}): IncidentPattern {
  return {
    triggerSignature: overrides.triggerSignature ?? 'z-score|txPoolPending|z:3.0|v:120',
    action: overrides.action ?? 'restart-batcher',
    occurrences: overrides.occurrences ?? 5,
    successRate: overrides.successRate ?? 0.8,
    avgResolutionMs: overrides.avgResolutionMs ?? 11000,
    samples:
      overrides.samples ??
      [
        makeSample('success', '2026-02-28T00:00:00.000Z'),
        makeSample('success', '2026-02-27T00:00:00.000Z'),
      ],
  };
}

describe('playbook generator', () => {
  it('generates a pattern-based playbook with inferred status/performance', () => {
    const pattern = makePattern({ successRate: 0.9, occurrences: 8 });
    const playbook = generatePlaybookFromPattern({
      instanceId: 'inst-a',
      pattern,
      now: new Date('2026-02-28T12:00:00.000Z'),
    });

    expect(playbook.generatedFrom).toBe('pattern');
    expect(playbook.playbookId.startsWith('pb-')).toBe(true);
    expect(playbook.reviewStatus).toBe('approved');
    expect(playbook.performance.totalApplications).toBe(8);
    expect(playbook.performance.lastOutcome).toBe('success');
    expect(playbook.evolution.version).toBe(1);
  });

  it('merges reinforcement pattern and updates confidence + changelog', () => {
    const base = generatePlaybookFromPattern({
      instanceId: 'inst-a',
      pattern: makePattern({ successRate: 0.7, occurrences: 4 }),
      now: new Date('2026-02-28T12:00:00.000Z'),
    });

    const updated = mergePatternIntoPlaybook({
      playbook: base,
      pattern: makePattern({ successRate: 1, occurrences: 10 }),
      now: new Date('2026-03-01T00:00:00.000Z'),
    });

    expect(updated.confidence).toBeGreaterThan(base.confidence);
    expect(updated.evolution.version).toBe(2);
    expect(updated.evolution.changelog).toHaveLength(2);
    expect(updated.performance.totalApplications).toBe(10);
  });
});
