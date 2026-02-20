/**
 * EOA Detector — Derive batcher/proposer EOAs from private keys
 *
 * Strategy:
 * 1. Manual environment variables (BATCHER_EOA_ADDRESS, PROPOSER_EOA_ADDRESS)
 * 2. Private keys in secrets (BATCHER_PRIVATE_KEY, PROPOSER_PRIVATE_KEY) → derive EOA
 * 3. Not detected (requires manual setup)
 *
 * No L1 RPC calls required (rate limit friendly).
 */

import { getAddress, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { EOARole } from '@/types/eoa-balance';

// ============================================================
// Type Definitions
// ============================================================

export interface DetectionResult {
  batcherEOA?: `0x${string}`;
  proposerEOA?: `0x${string}`;
  source: 'manual-env' | 'private-key' | 'not-detected';
  confidence: 'high' | 'medium' | 'low';
  message?: string;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Derive EOA address from private key
 * Returns null if private key is invalid
 */
function deriveEOAFromPrivateKey(privateKey: string): `0x${string}` | null {
  try {
    // Ensure it starts with 0x
    const normalizedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(normalizedKey as `0x${string}`);
    return account.address;
  } catch (error) {
    console.error('[EOA Detector] Failed to derive EOA from private key:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Get private key from environment
 */
function getPrivateKeyFromEnv(role: EOARole): string | null {
  const envKey = role === 'batcher' ? 'BATCHER_PRIVATE_KEY' : 'PROPOSER_PRIVATE_KEY';
  return process.env[envKey] || null;
}

/**
 * Get EOA address from environment variable
 */
function getEOAFromEnv(role: EOARole): `0x${string}` | null {
  const envKey = role === 'batcher' ? 'BATCHER_EOA_ADDRESS' : 'PROPOSER_EOA_ADDRESS';
  const envAddr = process.env[envKey];

  // Check if env var exists and is not empty
  if (envAddr && envAddr.trim()) {
    // Normalize address: convert to lowercase for validation (handles 0X prefix)
    const normalizedAddr = envAddr.trim().toLowerCase();
    if (isAddress(normalizedAddr)) {
      try {
        return getAddress(normalizedAddr) as `0x${string}`;
      } catch {
        return null;
      }
    }
  }

  return null;
}

// ============================================================
// Public API
// ============================================================

/**
 * Derive EOA for a specific role
 *
 * Priority:
 * 1. BATCHER_EOA_ADDRESS / PROPOSER_EOA_ADDRESS (manual)
 * 2. BATCHER_PRIVATE_KEY / PROPOSER_PRIVATE_KEY (derived)
 * 3. null (not available)
 *
 * No L1 RPC calls required.
 */
export async function getEOAAddressWithAutoDetect(
  role: EOARole,
  _l1RpcUrl?: string  // Ignored - kept for backward compatibility
): Promise<`0x${string}` | null> {
  void _l1RpcUrl;

  // Priority 1: Manual EOA address
  const manualEOA = getEOAFromEnv(role);
  if (manualEOA) {
    console.info(`[EOA Detector] Using manual ${role} EOA: ${manualEOA}`);
    return manualEOA;
  }

  // Priority 2: Derive from private key
  const privateKey = getPrivateKeyFromEnv(role);
  if (privateKey) {
    const derivedEOA = deriveEOAFromPrivateKey(privateKey);
    if (derivedEOA) {
      console.info(`[EOA Detector] Derived ${role} EOA from private key: ${derivedEOA}`);
      return derivedEOA;
    } else {
      console.error(`[EOA Detector] Failed to derive ${role} EOA from private key`);
    }
  }

  // Not available
  console.warn(`[EOA Detector] No ${role} EOA available. Set ${role === 'batcher' ? 'BATCHER_EOA_ADDRESS or BATCHER_PRIVATE_KEY' : 'PROPOSER_EOA_ADDRESS or PROPOSER_PRIVATE_KEY'}`);
  return null;
}

/**
 * Detect or use manual EOAs for both batcher and proposer
 *
 * Returns detection result with source and confidence level.
 * No L1 RPC calls required.
 */
export async function detectOrUseManualEOA(
  _l1RpcUrl?: string,  // Ignored - kept for backward compatibility
  _networkKey?: string  // Ignored - kept for backward compatibility
): Promise<DetectionResult> {
  void _l1RpcUrl;
  void _networkKey;

  // Try to get batcher and proposer EOAs
  const batcherEOA = await getEOAAddressWithAutoDetect('batcher');
  const proposerEOA = await getEOAAddressWithAutoDetect('proposer');

  // Determine source and confidence
  const batcherSource = getEOAFromEnv('batcher') ? 'manual-env' : getPrivateKeyFromEnv('batcher') ? 'private-key' : null;
  const proposerSource = getEOAFromEnv('proposer') ? 'manual-env' : getPrivateKeyFromEnv('proposer') ? 'private-key' : null;

  // Both EOAs must be present for a valid detection
  if (!batcherEOA || !proposerEOA) {
    return {
      source: 'not-detected',
      confidence: 'low',
      message: 'No EOAs configured. Set BATCHER_EOA_ADDRESS/PROPOSER_EOA_ADDRESS or BATCHER_PRIVATE_KEY/PROPOSER_PRIVATE_KEY',
    };
  }

  // If both are manual, mark as manual-env with high confidence
  if (batcherSource === 'manual-env' && proposerSource === 'manual-env') {
    return {
      batcherEOA,
      proposerEOA,
      source: 'manual-env',
      confidence: 'high',
      message: 'EOAs loaded from manual environment variables',
    };
  }

  // If both are derived from private keys, mark as private-key with high confidence
  if (batcherSource === 'private-key' && proposerSource === 'private-key') {
    return {
      batcherEOA,
      proposerEOA,
      source: 'private-key',
      confidence: 'high',
      message: 'EOAs derived from private keys',
    };
  }

  // Mixed: one manual, one from private key (both present but different sources)
  return {
    batcherEOA,
    proposerEOA,
    source: 'private-key',  // Default to private-key if mixed
    confidence: 'medium',
    message: 'EOAs from mixed sources (manual and/or private key)',
  };
}
