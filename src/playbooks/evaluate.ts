/**
 * AbstractPlaybook Condition Evaluation
 *
 * Evaluates MetricCondition[] against AnomalyEvent.
 * Used by playbook-matcher to determine if an AbstractPlaybook applies.
 */

import type { AnomalyEvent } from '@/types/anomaly'
import type { MetricCondition } from './types'

/**
 * Get anomalies from an AnomalyEvent
 */
function flattenResults(event: AnomalyEvent) {
  return event.anomalies
}

/**
 * Evaluate a single MetricCondition against an AnomalyEvent
 *
 * @returns true if condition matches, false otherwise
 */
export function evaluateCondition(
  cond: MetricCondition,
  event: AnomalyEvent
): boolean {
  const results = flattenResults(event)
  const match = results.find(r => r.metric === cond.metric)

  // Metric not detected as anomaly in this cycle
  if (!match || !match.isAnomaly) return false

  switch (cond.op) {
    case 'gt':
      return match.value > (cond.threshold ?? 0)

    case 'lt':
      return match.value < (cond.threshold ?? 0)

    case 'gte':
      return match.value >= (cond.threshold ?? 0)

    case 'lte':
      return match.value <= (cond.threshold ?? 0)

    case 'z_score_gt':
      return Math.abs(match.zScore) > (cond.threshold ?? 3.0)

    case 'rule':
      return match.rule === cond.rule

    default:
      return false
  }
}

/**
 * Evaluate all conditions (AND logic)
 *
 * All conditions must be satisfied for this function to return true.
 * Empty conditions array always returns false (prevents catch-all playbooks).
 *
 * @returns true if all conditions match, false otherwise
 */
export function evaluateConditions(
  conditions: MetricCondition[],
  event: AnomalyEvent
): boolean {
  // Empty conditions never match (prevents catch-all playbooks)
  if (conditions.length === 0) return false

  // All conditions must match (AND logic)
  return conditions.every(c => evaluateCondition(c, event))
}
