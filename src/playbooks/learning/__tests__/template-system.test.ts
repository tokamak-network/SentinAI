import { describe, expect, it } from 'vitest';
import {
  listPlaybookTemplates,
  renderPlaybookNarrative,
  selectTemplateForPattern,
} from '@/playbooks/learning/template-system';
import { generatePlaybookFromPattern } from '@/playbooks/learning/playbook-generator';
import type { IncidentPattern, OperationRecord } from '@/playbooks/learning/types';

function makeSample(metricName: string, anomalyType: string): OperationRecord {
  return {
    operationId: 'op-1',
    instanceId: 'inst-a',
    timestamp: '2026-02-28T00:00:00.000Z',
    trigger: {
      anomalyType,
      metricName,
      metricValue: 220,
      zScore: 3.8,
    },
    playbookId: null,
    action: 'restart-batcher',
    outcome: 'success',
    resolutionMs: 12000,
    verificationPassed: true,
  };
}

function makePattern(): IncidentPattern {
  return {
    triggerSignature: 'z-score|txPoolPending|z:3.5|v:220',
    action: 'restart-batcher',
    occurrences: 6,
    successRate: 0.83,
    avgResolutionMs: 12500,
    samples: [makeSample('txPoolPending', 'z-score')],
  };
}

describe('template system', () => {
  it('lists registered templates including fallback', () => {
    const templates = listPlaybookTemplates();
    expect(templates.length).toBeGreaterThan(1);
    expect(templates.some((t) => t.templateId === 'generic-incident-response')).toBe(true);
  });

  it('selects specialized template for txpool pressure pattern', () => {
    const selected = selectTemplateForPattern(makePattern());

    expect(selected.templateId).toBe('txpool-pressure-recovery');
    expect(selected.confidence).toBeGreaterThanOrEqual(0.4);
  });

  it('renders narrative with template rationale and pattern stats', () => {
    const pattern = makePattern();
    const playbook = generatePlaybookFromPattern({ instanceId: 'inst-a', pattern });
    const template = selectTemplateForPattern(pattern);

    const narrative = renderPlaybookNarrative({ playbook, pattern, template });

    expect(narrative).toContain('auto-generated playbook');
    expect(narrative).toContain('Pattern confidence');
    expect(narrative).toContain(template.label);
  });
});
