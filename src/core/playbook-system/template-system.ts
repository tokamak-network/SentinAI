import type { EvolvedPlaybook, IncidentPattern, OperationRecord } from '@/core/playbook-system/types';

export interface PlaybookTemplate {
  templateId: string;
  label: string;
  triggerMetric: string;
  anomalyType?: string;
  actionPrefix?: string;
  description: string;
  suggestedActions: string[];
  defaultMaxAttempts: number;
}

export interface AppliedTemplate {
  templateId: string;
  label: string;
  confidence: number;
  reason: string;
  suggestedActions: string[];
  defaultMaxAttempts: number;
}

const DEFAULT_TEMPLATE: PlaybookTemplate = {
  templateId: 'generic-incident-response',
  label: 'Generic Incident Response',
  triggerMetric: '*',
  description: 'Fallback template when no specialized pattern is available.',
  suggestedActions: ['collect-logs', 'health-check', 'escalate-operator'],
  defaultMaxAttempts: 1,
};

const TEMPLATES: PlaybookTemplate[] = [
  {
    templateId: 'txpool-pressure-recovery',
    label: 'TxPool Pressure Recovery',
    triggerMetric: 'txPoolPending',
    anomalyType: 'z-score',
    actionPrefix: 'restart',
    description: 'Recover sequencer throughput when tx pool backlog spikes.',
    suggestedActions: ['restart-batcher', 'scale-4vcpu', 'health-check'],
    defaultMaxAttempts: 2,
  },
  {
    templateId: 'l1-rpc-failover-recovery',
    label: 'L1 RPC Failover Recovery',
    triggerMetric: 'l1RpcLatency',
    anomalyType: 'threshold',
    actionPrefix: 'switch-l1-rpc',
    description: 'Switch to healthy upstream endpoint when L1 RPC degrades.',
    suggestedActions: ['switch-l1-rpc', 'verify-endpoint-health', 'escalate-operator'],
    defaultMaxAttempts: 2,
  },
  {
    templateId: 'peer-drop-recovery',
    label: 'Peer Connectivity Recovery',
    triggerMetric: 'peerCount',
    anomalyType: 'threshold',
    actionPrefix: 'restart',
    description: 'Restore peer connectivity when active peers fall below baseline.',
    suggestedActions: ['restart-sequencer', 'check-l1-connection', 'escalate-operator'],
    defaultMaxAttempts: 2,
  },
];

function hasMetricSamples(pattern: IncidentPattern, metricName: string): boolean {
  return pattern.samples.some((sample) => sample.trigger.metricName === metricName);
}

function actionPrefix(action: string): string {
  return action.split('-')[0] || action;
}

export function listPlaybookTemplates(): PlaybookTemplate[] {
  return [...TEMPLATES, DEFAULT_TEMPLATE];
}

export function selectTemplateForPattern(pattern: IncidentPattern): AppliedTemplate {
  const matched = TEMPLATES
    .map((template) => {
      let score = 0;
      if (template.triggerMetric !== '*' && hasMetricSamples(pattern, template.triggerMetric)) score += 0.5;
      if (template.anomalyType && pattern.samples.some((s) => s.trigger.anomalyType === template.anomalyType)) score += 0.3;
      if (template.actionPrefix && actionPrefix(pattern.action) === template.actionPrefix) score += 0.2;
      return { template, score };
    })
    .sort((a, b) => b.score - a.score);

  const winner = matched[0];

  if (!winner || winner.score < 0.4) {
    return {
      templateId: DEFAULT_TEMPLATE.templateId,
      label: DEFAULT_TEMPLATE.label,
      confidence: 0.3,
      reason: 'No specialized template matched; using generic fallback.',
      suggestedActions: DEFAULT_TEMPLATE.suggestedActions,
      defaultMaxAttempts: DEFAULT_TEMPLATE.defaultMaxAttempts,
    };
  }

  return {
    templateId: winner.template.templateId,
    label: winner.template.label,
    confidence: winner.score,
    reason: `Matched metric/action/anomaly features for ${winner.template.label}`,
    suggestedActions: winner.template.suggestedActions,
    defaultMaxAttempts: winner.template.defaultMaxAttempts,
  };
}

export function renderPlaybookNarrative(input: {
  playbook: EvolvedPlaybook;
  pattern: IncidentPattern;
  template: AppliedTemplate;
}): string {
  const latestSample: OperationRecord | undefined = input.pattern.samples[0];
  const latestMetric = latestSample?.trigger.metricName ?? 'unknown-metric';
  const successPercent = (input.pattern.successRate * 100).toFixed(1);

  return [
    `[${input.template.label}] auto-generated playbook`,
    `Trigger: ${latestMetric} (${input.pattern.triggerSignature})`,
    `Action: ${input.playbook.action}`,
    `Pattern confidence: ${successPercent}% success across ${input.pattern.occurrences} incidents`,
    `Template rationale: ${input.template.reason}`,
  ].join(' | ');
}
