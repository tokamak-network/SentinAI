import type { EvolvedPlaybook, PlaybookReviewStatus } from '@/core/playbook-system/types';

export interface PlaybookValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface PlaybookValidationResult {
  valid: boolean;
  issues: PlaybookValidationIssue[];
}

const ALLOWED_STATUS_TRANSITIONS: Record<PlaybookReviewStatus, PlaybookReviewStatus[]> = {
  draft: ['pending', 'archived', 'suspended'],
  pending: ['approved', 'archived', 'suspended'],
  approved: ['trusted', 'suspended', 'archived'],
  trusted: ['suspended', 'archived'],
  suspended: ['pending', 'approved', 'archived'],
  archived: [],
};

function isIso(value: string): boolean {
  return Number.isFinite(new Date(value).getTime());
}

export function validatePlaybookShape(playbook: EvolvedPlaybook): PlaybookValidationResult {
  const issues: PlaybookValidationIssue[] = [];

  if (!playbook.playbookId.trim()) {
    issues.push({ field: 'playbookId', message: 'playbookId is required', severity: 'error' });
  }

  if (!playbook.instanceId.trim()) {
    issues.push({ field: 'instanceId', message: 'instanceId is required', severity: 'error' });
  }

  if (!playbook.action.trim()) {
    issues.push({ field: 'action', message: 'action is required', severity: 'error' });
  }

  if (playbook.confidence < 0 || playbook.confidence > 1) {
    issues.push({ field: 'confidence', message: 'confidence must be between 0 and 1', severity: 'error' });
  }

  if (playbook.performance.successRate < 0 || playbook.performance.successRate > 1) {
    issues.push({ field: 'performance.successRate', message: 'successRate must be between 0 and 1', severity: 'error' });
  }

  if (playbook.performance.totalApplications < 0) {
    issues.push({
      field: 'performance.totalApplications',
      message: 'totalApplications must be non-negative',
      severity: 'error',
    });
  }

  if (!isIso(playbook.performance.lastApplied)) {
    issues.push({ field: 'performance.lastApplied', message: 'lastApplied must be ISO datetime', severity: 'error' });
  }

  if (playbook.evolution.version < 1) {
    issues.push({ field: 'evolution.version', message: 'version must be >= 1', severity: 'error' });
  }

  if (playbook.evolution.changelog.length === 0) {
    issues.push({ field: 'evolution.changelog', message: 'at least one changelog entry required', severity: 'error' });
  }

  for (const entry of playbook.evolution.changelog) {
    if (!isIso(entry.timestamp)) {
      issues.push({
        field: `evolution.changelog[${entry.version}].timestamp`,
        message: 'invalid timestamp',
        severity: 'error',
      });
    }
  }

  if (playbook.reviewStatus === 'trusted' && playbook.confidence < 0.9) {
    issues.push({
      field: 'reviewStatus',
      message: 'trusted status should only be used when confidence >= 0.9',
      severity: 'warning',
    });
  }

  if (playbook.reviewStatus === 'approved' && playbook.confidence < 0.7) {
    issues.push({
      field: 'reviewStatus',
      message: 'approved status typically requires confidence >= 0.7',
      severity: 'warning',
    });
  }

  return {
    valid: issues.every((issue) => issue.severity !== 'error'),
    issues,
  };
}

export function validateStatusTransition(input: {
  from: PlaybookReviewStatus;
  to: PlaybookReviewStatus;
}): PlaybookValidationResult {
  const allowed = ALLOWED_STATUS_TRANSITIONS[input.from] ?? [];
  const canTransition = allowed.includes(input.to);

  if (canTransition) {
    return { valid: true, issues: [] };
  }

  return {
    valid: false,
    issues: [
      {
        field: 'reviewStatus',
        message: `Transition not allowed: ${input.from} → ${input.to}`,
        severity: 'error',
      },
    ],
  };
}
