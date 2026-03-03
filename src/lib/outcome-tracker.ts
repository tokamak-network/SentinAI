/**
 * Outcome Tracker — Operation Outcome Classification & Billing Events
 *
 * Bridges VerifierAgent verification results to the billing system.
 * Classifies each verified operation into one of four outcome types
 * and emits a billing event with appropriate value:
 *
 *   - auto-resolved (1.0): Agent autonomously resolved the issue
 *   - escalated     (0.3): Agent acted but required human follow-up
 *   - false-positive (0.0): No real issue — no action was needed
 *   - failed         (0.0): Operation did not succeed
 *
 * When trigger context is available, also records the outcome as
 * an experience entry for the Agent Resume system.
 *
 * Usage:
 *   import { trackOutcome } from '@/lib/outcome-tracker';
 *
 *   const billingEvent = await trackOutcome({
 *     instanceId: 'inst-1',
 *     operationId: 'op-abc',
 *     executed: true,
 *     passed: true,
 *     resolutionMs: 30000,
 *     trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 },
 *     action: 'scale_up',
 *   });
 */

import { randomUUID } from 'node:crypto';
import logger from '@/lib/logger';
import { recordExperience } from '@/lib/experience-store';
import type { BillingEvent, OutcomeType } from '@/types/billing';

/** Value assigned to each outcome type for billing purposes. */
const OUTCOME_VALUES: Record<OutcomeType, number> = {
  'auto-resolved': 1.0,
  'escalated': 0.3,
  'false-positive': 0,
  'failed': 0,
};

/** Maps outcome type to experience store outcome format. */
const OUTCOME_TO_EXPERIENCE: Record<OutcomeType, 'success' | 'partial' | 'failure'> = {
  'auto-resolved': 'success',
  'escalated': 'partial',
  'false-positive': 'failure',
  'failed': 'failure',
};

/**
 * Classify a verification result into an OutcomeType.
 *
 * Decision matrix:
 *   executed + passed  → auto-resolved (agent solved it autonomously)
 *   executed + !passed → escalated     (agent acted but verification failed)
 *   !executed + passed → false-positive (no action needed, system was fine)
 *   !executed + !passed → failed       (no action taken and issue persists)
 */
export function classifyOutcome(result: { executed: boolean; passed: boolean }): OutcomeType {
  if (result.executed && result.passed) return 'auto-resolved';
  if (result.executed && !result.passed) return 'escalated';
  if (!result.executed && result.passed) return 'false-positive';
  return 'failed';
}

/**
 * Create a BillingEvent from classification results.
 * Value is determined by the OUTCOME_VALUES lookup table.
 */
export function createBillingEvent(input: {
  instanceId: string;
  operationId: string;
  outcomeType: OutcomeType;
  metadata?: Record<string, unknown>;
}): BillingEvent {
  return {
    id: randomUUID(),
    instanceId: input.instanceId,
    timestamp: new Date().toISOString(),
    eventType: 'operation-outcome',
    outcomeType: input.outcomeType,
    operationId: input.operationId,
    value: OUTCOME_VALUES[input.outcomeType],
    metadata: input.metadata ?? {},
  };
}

/**
 * Track an operation outcome end-to-end:
 *   1. Classify the verification result
 *   2. Create a billing event
 *   3. Optionally record as experience (when trigger context is provided)
 *
 * Returns the generated BillingEvent. Experience recording failures
 * are logged but do not prevent the billing event from being returned.
 */
export async function trackOutcome(payload: {
  instanceId: string;
  operationId: string;
  executed: boolean;
  passed: boolean;
  resolutionMs: number;
  trigger?: { type: string; metric: string; value: number };
  action?: string;
  protocolId?: string;
  metricsSnapshot?: Record<string, number>;
}): Promise<BillingEvent> {
  const outcomeType = classifyOutcome(payload);
  const event = createBillingEvent({
    instanceId: payload.instanceId,
    operationId: payload.operationId,
    outcomeType,
  });

  // Record as experience when trigger context is available
  if (payload.trigger && payload.action) {
    try {
      await recordExperience({
        instanceId: payload.instanceId,
        protocolId: payload.protocolId ?? 'unknown',
        category: 'anomaly-resolution',
        trigger: payload.trigger,
        action: payload.action,
        outcome: OUTCOME_TO_EXPERIENCE[outcomeType],
        resolutionMs: payload.resolutionMs,
        metricsSnapshot: payload.metricsSnapshot ?? {},
      });
    } catch (err) {
      logger.warn('[OutcomeTracker] Failed to record experience', { error: err });
    }
  }

  logger.info('[OutcomeTracker] Tracked outcome', {
    instanceId: payload.instanceId,
    outcomeType,
    value: event.value,
  });

  return event;
}
