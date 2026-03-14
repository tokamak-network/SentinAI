/**
 * SIWE Session Management
 * Issues and verifies session tokens for admin authentication.
 * Uses HMAC-SHA256 for token integrity verification.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { privateKeyToAccount, verifyMessage } from 'viem/accounts';
import logger from '@/lib/logger';

export const SESSION_COOKIE_NAME = 'sentinai_admin_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminSession {
  address: `0x${string}`;
  issuedAt: number;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Helper: Get admin address from MARKETPLACE_WALLET_KEY
// ---------------------------------------------------------------------------

export function getAdminAddress(): `0x${string}` | null {
  const key = process.env.MARKETPLACE_WALLET_KEY;
  if (!key) {
    logger.warn('[SIWE Session] MARKETPLACE_WALLET_KEY not set');
    return null;
  }

  try {
    const account = privateKeyToAccount(key as `0x${string}`);
    return account.address;
  } catch (err) {
    logger.error('[SIWE Session] Failed to derive admin address:', (err as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token generation and verification
// ---------------------------------------------------------------------------

function getHmacKey(): string {
  const key = process.env.SENTINAI_API_KEY;
  if (!key) {
    throw new Error('SENTINAI_API_KEY not set');
  }
  return key;
}

/**
 * Issue a session token.
 * Format: satv2_{address}_{issuedAt}_{expiresAt}_{hmac}
 */
export function issueSessionToken(address: `0x${string}`): string {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_TTL_MS;

  const payload = `${address}|${issuedAt}|${expiresAt}`;
  const hmac = createHmac('sha256', getHmacKey());
  hmac.update(payload);
  const signature = hmac.digest('hex');

  return `satv2_${address}_${issuedAt}_${expiresAt}_${signature}`;
}

/**
 * Verify a session token.
 * Returns session data if valid, null otherwise.
 */
export function verifySessionToken(token: string): AdminSession | null {
  if (!token.startsWith('satv2_')) {
    return null;
  }

  const parts = token.slice(6).split('_');
  if (parts.length !== 4) {
    return null;
  }

  const [address, issuedAtStr, expiresAtStr, signature] = parts;

  // Validate address format
  if (!address.startsWith('0x') || address.length !== 42) {
    return null;
  }

  // Validate timestamps
  const issuedAt = parseInt(issuedAtStr, 10);
  const expiresAt = parseInt(expiresAtStr, 10);

  if (isNaN(issuedAt) || isNaN(expiresAt)) {
    return null;
  }

  // Check expiration
  if (Date.now() > expiresAt) {
    return null;
  }

  // Verify HMAC
  const payload = `${address}|${issuedAt}|${expiresAt}`;
  const hmac = createHmac('sha256', getHmacKey());
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');

  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    address: address as `0x${string}`,
    issuedAt,
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// SIWE Message formatting
// ---------------------------------------------------------------------------

export function generateSiweMessage(address: `0x${string}`, nonce: string): string {
  const domain = process.env.VERCEL_URL || 'localhost:3002';
  const scheme = domain.includes('localhost') ? 'http' : 'https';
  const uri = `${scheme}://${domain}`;

  return `${uri} wants you to sign in with your Ethereum account:\n${address}\n\nAdmin access to SentinAI dashboard.\n\nURI: ${uri}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
}

// ---------------------------------------------------------------------------
// SIWE Message verification (viem-based)
// ---------------------------------------------------------------------------

export async function verifySiweMessage(
  message: string,
  signature: string,
  expectedAddress: `0x${string}`
): Promise<boolean> {
  try {
    const recoveredAddress = await verifyMessage({
      message,
      signature: signature as `0x${string}`,
    });

    return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
  } catch (err) {
    logger.error('[SIWE Session] Signature verification failed:', (err as Error).message);
    return false;
  }
}
