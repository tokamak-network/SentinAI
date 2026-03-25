import type { EvolvedPlaybook, IncidentPattern } from './types';
import { inferStatus } from './config';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shortId(input: string): string {
  const normalized = input.toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }
  return `pb-${Math.abs(hash).toString(36)}`;
}

function calculateInitialConfidence(pattern: IncidentPattern): number {
  const baseline = 0.4;
  const qualityBoost = (pattern.successRate - 0.5) * 0.4;
  const frequencyBoost = Math.min((pattern.occurrences - 3) * 0.03, 0.15);
  return clamp(baseline + qualityBoost + frequencyBoost, 0, 1);
}

export function generatePlaybookFromPattern(input: {
  instanceId: string;
  pattern: IncidentPattern;
  now?: Date;
}): EvolvedPlaybook {
  const nowIso = (input.now ?? new Date()).toISOString();
  const confidence = calculateInitialConfidence(input.pattern);
  const playbookId = shortId(`${input.instanceId}|${input.pattern.triggerSignature}|${input.pattern.action}`);
  const lastSample = input.pattern.samples[0];

  return {
    playbookId,
    instanceId: input.instanceId,
    triggerSignature: input.pattern.triggerSignature,
    action: input.pattern.action,
    confidence,
    reviewStatus: inferStatus(confidence),
    generatedFrom: 'pattern',
    performance: {
      totalApplications: input.pattern.occurrences,
      successRate: input.pattern.successRate,
      avgResolutionMs: input.pattern.avgResolutionMs,
      lastApplied: lastSample?.timestamp ?? nowIso,
      lastOutcome: lastSample?.outcome ?? 'partial',
    },
    evolution: {
      version: 1,
      changelog: [
        {
          version: 1,
          timestamp: nowIso,
          reason: `Auto-generated from recurring pattern (${input.pattern.occurrences} occurrences)` ,
          confidenceDelta: confidence,
          changedBy: 'system',
        },
      ],
    },
  };
}

export function mergePatternIntoPlaybook(input: {
  playbook: EvolvedPlaybook;
  pattern: IncidentPattern;
  now?: Date;
}): EvolvedPlaybook {
  const nowIso = (input.now ?? new Date()).toISOString();
  const targetConfidence = calculateInitialConfidence(input.pattern);
  const confidenceDelta = clamp(targetConfidence - input.playbook.confidence, -0.2, 0.2);
  const nextConfidence = clamp(input.playbook.confidence + confidenceDelta, 0, 1);

  const lastSample = input.pattern.samples[0];
  const nextVersion = input.playbook.evolution.version + 1;

  return {
    ...input.playbook,
    confidence: nextConfidence,
    reviewStatus: inferStatus(nextConfidence),
    performance: {
      totalApplications: input.pattern.occurrences,
      successRate: input.pattern.successRate,
      avgResolutionMs: input.pattern.avgResolutionMs,
      lastApplied: lastSample?.timestamp ?? nowIso,
      lastOutcome: lastSample?.outcome ?? input.playbook.performance.lastOutcome,
    },
    evolution: {
      version: nextVersion,
      changelog: [
        ...input.playbook.evolution.changelog,
        {
          version: nextVersion,
          timestamp: nowIso,
          reason: `Pattern reinforcement: successRate=${(input.pattern.successRate * 100).toFixed(1)}%`,
          confidenceDelta,
          changedBy: 'system',
        },
      ],
    },
  };
}
