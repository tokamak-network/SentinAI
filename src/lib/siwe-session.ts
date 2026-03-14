/**
 * SIWE (Sign-In with Ethereum) Session Management
 * Issues self-verifiable HMAC-based session tokens for admin access.
 * Token format: satv2_{address_lower}_{issuedAt}_{expiresAt}_{hmac}
 * No external storage needed (HMAC-verified).
 */

import { createHmac } from 'crypto';
import { getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import logger from '@/lib/logger';

export const SESSION_COOKIE_NAME = 'sentinai_admin_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
export const SESSION_TTL_SECONDS = 28800;

export interface AdminSession {
  address: `0x${string}`;
  issuedAt: number;
  expiresAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get admin address from MARKETPLACE_WALLET_KEY
// ─────────────────────────────────────────────────────────────────────────────

export function getAdminAddress(): `0x${string}` | null {
  const walletKey = process.env.MARKETPLACE_WALLET_KEY?.trim();
  if (!walletKey) {
    logger.warn('[SIWE] MARKETPLACE_WALLET_KEY not set');
    return null;
  }

  try {
    const account = privateKeyToAccount(walletKey as `0x${string}`);
    return getAddress(account.address); // Checksum address
  } catch (error) {
    logger.error('[SIWE] Failed to derive admin address from MARKETPLACE_WALLET_KEY', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session token issuance and verification
// ─────────────────────────────────────────────────────────────────────────────

function getHmacSecret(): string {
  const secret = process.env.SENTINAI_API_KEY ?? '';
  if (!secret) {
    logger.warn('[SIWE] SENTINAI_API_KEY not set, session HMAC will be weak');
  }
  return secret;
}

function computeHmac(
  address: `0x${string}`,
  issuedAt: number,
  expiresAt: number
): string {
  const secret = getHmacSecret();
  const data = `${address.toLowerCase()}:${issuedAt}:${expiresAt}`;
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function issueSessionToken(address: `0x${string}`): string {
  const checksumAddress = getAddress(address);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_TTL_MS;

  const hmac = computeHmac(checksumAddress, issuedAt, expiresAt);
  return `satv2_${checksumAddress.toLowerCase()}_${issuedAt}_${expiresAt}_${hmac}`;
}

export function verifySessionToken(token: string): AdminSession | null {
  try {
    const parts = token.split('_');
    if (parts.length !== 5 || parts[0] !== 'satv2') return null;

    const [, addressStr, issuedAtStr, expiresAtStr, providedHmac] = parts;
    const address = `0x${addressStr}` as `0x${string}`;
    const issuedAt = parseInt(issuedAtStr, 10);
    const expiresAt = parseInt(expiresAtStr, 10);

    // Validate timestamp format
    if (isNaN(issuedAt) || isNaN(expiresAt)) return null;

    // Check expiration
    if (Date.now() > expiresAt) {
      logger.debug('[SIWE] Session token expired', { address, expiresAt });
      return null;
    }

    // Verify HMAC
    const expectedHmac = computeHmac(address, issuedAt, expiresAt);
    if (providedHmac !== expectedHmac) {
      logger.warn('[SIWE] Session token HMAC mismatch', { address });
      return null;
    }

    return { address, issuedAt, expiresAt };
  } catch (error) {
    logger.error('[SIWE] Failed to verify session token', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookie helper
// ─────────────────────────────────────────────────────────────────────────────

export function buildSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    'HttpOnly',
    secure,
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`;
}
