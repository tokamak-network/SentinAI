import { describe, expect, it } from 'vitest';
import { analyzeIncidentPatterns, buildTriggerSignature } from '@/playbooks/learning/incident-analyzer';
import type { OperationRecord } from '@/playbooks/learning/types';

function makeRecord(overrides: Partial<OperationRecord>): OperationRecord {
  return {
    operationId: overrides.operationId ?? crypto.randomUUID(),
    instanceId: overrides.instanceId ?? 'inst-a',
    timestamp: overrides.timestamp ?? '2026-02-28T00:00:00.000Z',
    trigger: {
      anomalyType: overrides.trigger?.anomalyType ?? 'z-score',
      metricName: overrides.trigger?.metricName ?? 'txPoolPending',
      zScore: overrides.trigger?.zScore,
      metricValue: overrides.trigger?.metricValue ?? 120,
    },
    playbookId: overrides.playbookId ?? null,
    action: overrides.action ?? 'restart-batcher',
    outcome: overrides.outcome ?? 'success',
    resolutionMs: overrides.resolutionMs ?? 15000,
    verificationPassed: overrides.verificationPassed ?? true,
    failureReason: overrides.failureReason,
  };
}

describe('incident analyzer', () => {
  it('buildTriggerSignature normalizes z-score and metric value bucket', () => {
    const signature = buildTriggerSignature(
      makeRecord({
        trigger: {
          anomalyType: 'z-score',
          metricName: 'txPoolPending',
          zScore: 3.74,
          metricValue: 123,
        },
      })
    );

    expect(signature).toBe('z-score|txPoolPending|z:3.5|v:120');
  });

  it('returns only groups with minimum occurrences in the time window', () => {
    const now = new Date('2026-02-28T12:00:00.000Z');
    const records: OperationRecord[] = [
      makeRecord({ operationId: '1', timestamp: '2026-02-27T00:00:00.000Z' }),
      makeRecord({ operationId: '2', timestamp: '2026-02-26T00:00:00.000Z' }),
      makeRecord({ operationId: '3', timestamp: '2026-02-25T00:00:00.000Z', outcome: 'failure' }),
      makeRecord({
        operationId: '4',
        timestamp: '2025-12-01T00:00:00.000Z',
      }),
      makeRecord({
        operationId: '5',
        action: 'scale-4vcpu',
        timestamp: '2026-02-27T00:00:00.000Z',
      }),
    ];

    const patterns = analyzeIncidentPatterns(records, { now });

    expect(patterns).toHaveLength(1);
    expect(patterns[0].occurrences).toBe(3);
    expect(patterns[0].successRate).toBeCloseTo(2 / 3);
  });

  it('isolates by instanceId even for same trigger/action', () => {
    const now = new Date('2026-02-28T12:00:00.000Z');
    const records: OperationRecord[] = [
      makeRecord({ instanceId: 'inst-a', operationId: 'a1' }),
      makeRecord({ instanceId: 'inst-a', operationId: 'a2' }),
      makeRecord({ instanceId: 'inst-a', operationId: 'a3' }),
      makeRecord({ instanceId: 'inst-b', operationId: 'b1' }),
      makeRecord({ instanceId: 'inst-b', operationId: 'b2' }),
      makeRecord({ instanceId: 'inst-b', operationId: 'b3' }),
    ];

    const patterns = analyzeIncidentPatterns(records, { now });

    expect(patterns).toHaveLength(2);
    expect(patterns.every((p) => p.occurrences === 3)).toBe(true);
  });
});
