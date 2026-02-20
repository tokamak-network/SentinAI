/**
 * EOA Balance Monitoring Types
 * Type definitions for batcher/proposer/challenger balance monitoring and auto-refill
 */

// ============================================================
// Core Types
// ============================================================

/** EOA role in the L2 stack (e.g. 'batcher', 'proposer', 'sequencer') */
export type EOARole = string;

/** Balance level relative to configured thresholds */
export type BalanceLevel = 'normal' | 'warning' | 'critical';

/** Reason why a refill was not executed */
export type RefillDeniedReason =
  | 'no-signer'
  | 'simulation'
  | 'cooldown'
  | 'daily-limit'
  | 'treasury-low'
  | 'gas-high'
  | 'tx-reverted'
  | 'tx-timeout'
  | 'disabled';

// ============================================================
// Configuration
// ============================================================

/** Threshold and limit configuration for EOA balance monitoring */
export interface EOABalanceConfig {
  /** Balance below this triggers warning alert (ETH) */
  warningThresholdEth: number;
  /** Balance below this triggers auto-refill and operator escalation (ETH) */
  criticalThresholdEth: number;
  /** Amount to refill per transaction (ETH) */
  refillAmountEth: number;
  /** Maximum daily refill total across all EOAs (ETH) */
  maxDailyRefillEth: number;
  /** Minimum interval between refills for same EOA (ms) */
  cooldownMs: number;
  /** Maximum L1 gas price to allow refill (gwei) */
  gasGuardGwei: number;
  /** Minimum treasury balance required to allow refill (ETH) */
  minTreasuryBalanceEth: number;
}

// ============================================================
// Results
// ============================================================

/** Result of checking an EOA balance against thresholds */
export interface BalanceCheckResult {
  /** EOA address */
  address: string;
  /** Role of this EOA */
  role: EOARole;
  /** Current balance in ETH */
  balanceEth: number;
  /** Balance level relative to thresholds */
  level: BalanceLevel;
  /** ISO timestamp of the check */
  timestamp: string;
}

/** Result of a refill transaction */
export interface RefillResult {
  /** Whether the refill was executed successfully */
  success: boolean;
  /** Transaction hash (if executed) */
  txHash?: string;
  /** Balance before refill (ETH) */
  previousBalanceEth?: number;
  /** Balance after refill (ETH) */
  newBalanceEth?: number;
  /** Amount refilled (ETH) */
  refillAmountEth?: number;
  /** Gas used by the transaction */
  gasUsed?: number;
  /** Reason if refill was denied or failed */
  reason?: RefillDeniedReason;
}

// ============================================================
// Status (for API/Dashboard)
// ============================================================

/** Aggregated balance status for all monitored EOAs */
export interface EOABalanceStatus {
  /** Dynamic role map from active chain plugin */
  roles: Record<EOARole, BalanceCheckResult | null>;
  /** Batcher EOA balance check result */
  batcher: BalanceCheckResult | null;
  /** Proposer EOA balance check result */
  proposer: BalanceCheckResult | null;
  /** Challenger EOA balance check result */
  challenger: BalanceCheckResult | null;
  /** Treasury balance (if signer configured) */
  treasury: BalanceCheckResult | null;
  /** Total ETH refilled today */
  dailyRefillTotalEth: number;
  /** Remaining daily refill allowance (ETH) */
  dailyRefillRemainingEth: number;
  /** Whether treasury private key is configured */
  signerAvailable: boolean;
}

// ============================================================
// Events
// ============================================================

/** Record of a refill event (for history/dashboard) */
export interface RefillEvent {
  /** ISO timestamp */
  timestamp: string;
  /** Target EOA role */
  role: EOARole;
  /** Target EOA address */
  targetAddress: string;
  /** Amount refilled (ETH) */
  amountEth: number;
  /** Transaction hash */
  txHash: string;
  /** Balance before refill (ETH) */
  previousBalanceEth: number;
  /** Balance after refill (ETH) */
  newBalanceEth: number;
  /** Whether executed in simulation mode */
  simulated: boolean;
}
