/**
 * Autonomy Ledger Types
 * Unified audit trail for all autonomous pipeline decisions and actions.
 */

export type LedgerEntryKind =
  | 'decision_taken'
  | 'action_executed'
  | 'action_suppressed'
  | 'fallback_triggered'
  | 'guardrail_blocked';

export type SuppressionReason =
  | 'simulation_mode'
  | 'whitelist_violation'
  | 'requires_approval'
  | 'policy_denied'
  | 'dry_run';

export interface LedgerEntry {
  id: string;
  kind: LedgerEntryKind;
  timestamp: string; // ISO 8601
  agent?: string;      // which agent produced this (e.g. 'executor-agent', 'remediation-engine')
  action?: string;     // action type (e.g. 'restart_pod', 'scale_execution')
  playbook?: string;   // playbook id if applicable
  verdict?: string;    // human-readable outcome summary
  suppressionReason?: SuppressionReason;
  meta?: Record<string, unknown>; // additional context (component, params, etc.)
}

export interface LedgerQuery {
  since?: string;      // ISO 8601 — return entries at or after this timestamp
  until?: string;      // ISO 8601 — return entries before this timestamp
  kind?: LedgerEntryKind;
  agent?: string;
  limit?: number;      // max entries to return (default: 100, max: 500)
}

export interface IAutonomyLedger {
  append(entry: Omit<LedgerEntry, 'id' | 'timestamp'>): Promise<LedgerEntry>;
  query(q?: LedgerQuery): Promise<LedgerEntry[]>;
}
