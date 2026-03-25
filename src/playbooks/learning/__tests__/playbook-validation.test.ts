import { describe, expect, it } from 'vitest';
import {
  validatePlaybookShape,
  validateStatusTransition,
} from '@/playbooks/learning/playbook-validation';
import { generatePlaybookFromPattern } from '@/playbooks/learning/playbook-generator';
import type { IncidentPattern } from '@/playbooks/learning/types';

function makePattern(): IncidentPattern {
  return {
    triggerSignature: 'threshold|peerCount|z:na|v:0',
    action: 'restart-sequencer',
    occurrences: 3,
    successRate: 0.66,
    avgResolutionMs: 24000,
    samples: [
      {
        operationId: 'op-a',
        instanceId: 'inst-a',
        timestamp: '2026-02-28T00:00:00.000Z',
        trigger: {
          anomalyType: 'threshold',
          metricName: 'peerCount',
          metricValue: 0,
        },
        playbookId: null,
        action: 'restart-sequencer',
        outcome: 'success',
        resolutionMs: 24000,
        verificationPassed: true,
      },
    ],
  };
}

describe('playbook validation', () => {
  it('validates generated playbook shape', () => {
    const playbook = generatePlaybookFromPattern({ instanceId: 'inst-a', pattern: makePattern() });
    const result = validatePlaybookShape(playbook);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('rejects invalid required fields', () => {
    const playbook = generatePlaybookFromPattern({ instanceId: 'inst-a', pattern: makePattern() });
    const broken = {
      ...playbook,
      playbookId: '',
      confidence: 1.2,
      performance: {
        ...playbook.performance,
        lastApplied: 'invalid-date',
      },
      evolution: {
        ...playbook.evolution,
        changelog: [],
      },
    };

    const result = validatePlaybookShape(broken);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'playbookId')).toBe(true);
    expect(result.issues.some((i) => i.field === 'confidence')).toBe(true);
    expect(result.issues.some((i) => i.field === 'performance.lastApplied')).toBe(true);
  });

  it('enforces review status transition rules', () => {
    const allowed = validateStatusTransition({ from: 'pending', to: 'approved' });
    const denied = validateStatusTransition({ from: 'approved', to: 'draft' });

    expect(allowed.valid).toBe(true);
    expect(denied.valid).toBe(false);
    expect(denied.issues[0].message).toContain('Transition not allowed');
  });
});
