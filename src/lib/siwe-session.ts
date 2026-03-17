/**
 * SIWE (Sign-In with Ethereum) Session Management
 * Issues self-verifiable HMAC-based session tokens for dashboard access.
 * Token format: satv2_{address_lower}_{issuedAt}_{expiresAt}_{hmac}
 * No external storage needed (HMAC-verified).
 *
 * Admin access is gated by SENTINAI_ADMIN_ADDRESS (public address, not a
 * private key). Only the matching wallet can authenticate via SIWE.
 * The authenticated wallet then signs on-chain transactions (e.g. ERC8004
 * registration) directly from the browser — no server-side key needed.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { getAddress } from 'viem';
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
// Admin address from env (public address only — no private key)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the admin address from SENTINAI_ADMIN_ADDRESS.
 * This is a plain Ethereum address (0x..., 42 chars), NOT a private key.
 */
export function getAdminAddress(): `0x${string}` | null {
  const raw = process.env.SENTINAI_ADMIN_ADDRESS?.trim();
  if (!raw) {
    logger.warn('[SIWE] SENTINAI_ADMIN_ADDRESS not set — admin login disabled');
    return null;
  }

  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
      logger.error('[SIWE] SENTINAI_ADMIN_ADDRESS is not a valid Ethereum address');
      return null;
    }
    return getAddress(raw as `0x${string}`);
  } catch (error) {
    logger.error('[SIWE] Failed to parse SENTINAI_ADMIN_ADDRESS', error);
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
  const data = `satv2_${address}_${issuedAt}_${expiresAt}`;
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function issueSessionToken(address: `0x${string}`): string {
  const apiKey = process.env.SENTINAI_API_KEY;
  if (!apiKey) {
    throw new Error('SENTINAI_API_KEY is not configured');
  }

  const checksumAddress = getAddress(address);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_TTL_MS;

  const hmac = computeHmac(checksumAddress, issuedAt, expiresAt);
  // Store address without 0x prefix in token to avoid parsing issues
  return `satv2_${checksumAddress.slice(2)}_${issuedAt}_${expiresAt}_${hmac}`;
}

export function verifySessionToken(token: string): AdminSession | null {
  const apiKey = process.env.SENTINAI_API_KEY;
  if (!apiKey) {
    logger.warn('[SIWE] SENTINAI_API_KEY is not configured; cannot verify session tokens');
    return null;
  }

  try {
    const parts = token.split('_');
    if (parts.length !== 5 || parts[0] !== 'satv2') return null;

    const [, addressStr, issuedAtStr, expiresAtStr, providedHmac] = parts;
    const address = `0x${addressStr}` as `0x${string}`;
    const issuedAt = parseInt(issuedAtStr, 10);
    const expiresAt = parseInt(expiresAtStr, 10);

    // Validate timestamp format
    if (isNaN(issuedAt) || isNaN(expiresAt)) return null;

    // Validate address format (40 hex characters without 0x prefix)
    if (!addressStr.match(/^[0-9a-fA-F]{40}$/)) {
      return null;
    }

    // Check expiration
    if (Date.now() > expiresAt) {
      logger.debug('[SIWE] Session token expired', { address, expiresAt });
      return null;
    }

    // Verify HMAC using timing-safe comparison
    const expectedHmac = computeHmac(address, issuedAt, expiresAt);
    try {
      const expectedBuffer = Buffer.from(expectedHmac);
      const providedBuffer = Buffer.from(providedHmac);

      if (expectedBuffer.length !== providedBuffer.length) {
        return null;
      }

      if (!timingSafeEqual(expectedBuffer, providedBuffer)) {
        logger.warn('[SIWE] Session token HMAC mismatch', { address });
        return null;
      }
    } catch {
      return null;
    }

    return { address, issuedAt, expiresAt };
  } catch (error) {
    logger.debug('[SIWE] Failed to verify session token', error);
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
