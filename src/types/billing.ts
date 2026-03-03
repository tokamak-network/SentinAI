/**
 * Billing Types
 *
 * Type definitions for the outcome-based billing system.
 * Each verified operation outcome can trigger a billing event,
 * bridging operational events to revenue for the Agent-for-Hire model.
 */

/** Classification of an operation outcome after verification. */
export type OutcomeType = 'auto-resolved' | 'escalated' | 'false-positive' | 'failed';

/**
 * A billable event emitted when an operation outcome is tracked.
 * Value is determined by outcome type:
 *   - auto-resolved: 1.0 (full value — autonomous resolution)
 *   - escalated:     0.3 (partial value — required human intervention)
 *   - false-positive: 0   (no value — no real issue existed)
 *   - failed:         0   (no value — operation did not succeed)
 */
export interface BillingEvent {
  id: string;
  instanceId: string;
  timestamp: string;
  eventType: 'operation-outcome';
  outcomeType: OutcomeType;
  operationId: string;
  value: number;
  metadata: Record<string, unknown>;
}
