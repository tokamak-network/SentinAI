/**
 * Root Cause Analysis Types
 * Type definitions for Optimism Rollup incident analysis
 */

import type { AISeverity } from './scaling';

/**
 * Optimism Rollup component identifier
 * - op-geth: Execution Client (executes L2 blocks)
 * - op-node: Consensus Client / Derivation Driver (derives L2 state from L1)
 * - op-batcher: Transaction Batch Submitter (submits L2 transactions to L1)
 * - op-proposer: State Root Proposer (submits L2 state roots to L1)
 * - l1: L1 Ethereum (external dependency)
 * - system: System-level events (K8s, network, etc.)
 */
export type RCAComponent =
  | 'op-geth'
  | 'op-node'
  | 'op-batcher'
  | 'op-proposer'
  | 'l1'
  | 'system';

/**
 * RCA event type
 * - error: Error log or critical failure
 * - warning: Warning log or attention-required state
 * - metric_anomaly: Metric outlier (Z-Score based)
 * - state_change: State change (scaling, restart, etc.)
 */
export type RCAEventType = 'error' | 'warning' | 'metric_anomaly' | 'state_change';

/**
 * RCA Event
 * Individual event that composes the timeline
 */
export interface RCAEvent {
  /** Unix timestamp (milliseconds) */
  timestamp: number;

  /** Component where the event occurred */
  component: RCAComponent;

  /** Event type */
  type: RCAEventType;

  /** Event description (human-readable) */
  description: string;

  /** Raw log line (if available) */
  rawLog?: string;

  /** Event severity (if available) */
  severity?: AISeverity;
}

/**
 * Component dependency
 * Defined based on Optimism Rollup architecture
 */
export interface ComponentDependency {
  /** Components this component depends on (upstream) */
  dependsOn: RCAComponent[];

  /** Components that depend on this component (downstream) */
  feeds: RCAComponent[];
}

/**
 * Root cause information
 */
export interface RootCauseInfo {
  /** Root cause component */
  component: RCAComponent;

  /** Root cause description */
  description: string;

  /** Analysis confidence (0-1) */
  confidence: number;
}

/**
 * Remediation advice
 */
export interface RemediationAdvice {
  /** Immediate action items */
  immediate: string[];

  /** Preventive measures */
  preventive: string[];
}

/**
 * RCA analysis result
 */
export interface RCAResult {
  /** Unique identifier (UUID) */
  id: string;

  /** Root cause information */
  rootCause: RootCauseInfo;

  /** Causal chain (from root cause to final symptoms) */
  causalChain: RCAEvent[];

  /** List of affected components */
  affectedComponents: RCAComponent[];

  /** Full event timeline (chronological) */
  timeline: RCAEvent[];

  /** Remediation advice */
  remediation: RemediationAdvice;

  /** Analysis completion time (ISO 8601) */
  generatedAt: string;
}

/**
 * RCA history entry
 */
export interface RCAHistoryEntry {
  /** Same as RCAResult.id */
  id: string;

  /** RCA analysis result */
  result: RCAResult;

  /** Trigger method */
  triggeredBy: 'manual' | 'auto';

  /** Trigger time (ISO 8601) */
  triggeredAt: string;
}

/**
 * RCA API request body
 */
export interface RCARequest {
  /** Auto-trigger flag (used with Proposal 2 integration) */
  autoTriggered?: boolean;
}

/**
 * RCA API response
 */
export interface RCAResponse {
  /** Success flag */
  success: boolean;

  /** RCA result (on success) */
  result?: RCAResult;

  /** Error message (on failure) */
  error?: string;

  /** Detailed error (for debugging) */
  message?: string;
}

/**
 * RCA history API response
 */
export interface RCAHistoryResponse {
  /** RCA history entries */
  history: RCAHistoryEntry[];

  /** Total history count */
  total: number;
}
