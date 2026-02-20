/**
 * Derivation Lag Types
 * OP Stack sync status and lag assessment.
 */

export interface SyncStatus {
  current_l1?: { number?: string };
  head_l1?: { number?: string };
  unsafe_l2?: { number?: string };
  safe_l2?: { number?: string };
  finalized_l2?: { number?: string };
}

export type LagLevel = 'normal' | 'warning' | 'critical' | 'emergency' | 'unknown';

export interface DerivationLagResult {
  available: boolean;
  lag: number | null;
  level: LagLevel;
  currentL1: number | null;
  headL1: number | null;
  unsafeL2: number | null;
  safeL2: number | null;
  finalizedL2: number | null;
  checkedAt: string;
  message?: string;
}

