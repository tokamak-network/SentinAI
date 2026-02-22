/**
 * Runtime Autonomy Policy
 * In-process mutable policy for autonomy level and confidence thresholds.
 */

import type { AutonomyLevel, RuntimeAutonomyPolicy } from '@/types/policy';

const globalForAutonomyPolicy = globalThis as unknown as {
  __sentinai_autonomy_policy?: RuntimeAutonomyPolicy;
};

function parseLevel(value: string | undefined): AutonomyLevel {
  if (value === 'A0' || value === 'A1' || value === 'A2' || value === 'A3' || value === 'A4' || value === 'A5') {
    return value;
  }
  return 'A2';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseConfidence(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return fallback;
  return clamp(parsed, 0, 1);
}

function buildDefaultPolicy(): RuntimeAutonomyPolicy {
  return {
    level: parseLevel(process.env.GOAL_AUTONOMY_LEVEL),
    minConfidenceDryRun: parseConfidence(process.env.GOAL_AUTONOMY_MIN_CONFIDENCE_DRY_RUN, 0.35),
    minConfidenceWrite: parseConfidence(process.env.GOAL_AUTONOMY_MIN_CONFIDENCE_WRITE, 0.65),
  };
}

export function getRuntimeAutonomyPolicy(): RuntimeAutonomyPolicy {
  if (!globalForAutonomyPolicy.__sentinai_autonomy_policy) {
    globalForAutonomyPolicy.__sentinai_autonomy_policy = buildDefaultPolicy();
  }
  return globalForAutonomyPolicy.__sentinai_autonomy_policy;
}

export function setRuntimeAutonomyPolicy(
  updates: Partial<RuntimeAutonomyPolicy>
): RuntimeAutonomyPolicy {
  const current = getRuntimeAutonomyPolicy();
  const next: RuntimeAutonomyPolicy = {
    level: updates.level ?? current.level,
    minConfidenceDryRun: clamp(updates.minConfidenceDryRun ?? current.minConfidenceDryRun, 0, 1),
    minConfidenceWrite: clamp(updates.minConfidenceWrite ?? current.minConfidenceWrite, 0, 1),
  };
  globalForAutonomyPolicy.__sentinai_autonomy_policy = next;
  return next;
}

export function resetRuntimeAutonomyPolicy(): void {
  globalForAutonomyPolicy.__sentinai_autonomy_policy = undefined;
}
