/**
 * SIWE (Sign-In with Ethereum) Session Management (Website Admin)
 * Issues self-verifiable HMAC-based session tokens.
 * Token format: admin_{address_lower}_{issuedAt}_{expiresAt}_{hmac}
 * No external storage needed (HMAC-verified).
 */

import { createHmac } from 'crypto';
import { getAddress, verifyMessage } from 'viem';

export const ADMIN_SESSION_COOKIE_NAME = 'sentinai_admin_session';
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
export const ADMIN_SESSION_TTL_SECONDS = 28800;

export interface AdminSessionData {
  address: `0x${string}`;
  issuedAt: number;
  expiresAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get admin address (from env variable)
// ─────────────────────────────────────────────────────────────────────────────

export function getAdminAddress(): `0x${string}` | null {
  // Website doesn't derive from private key
  // Instead, expect the authorized admin address directly
  const adminKey = process.env.NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY?.trim();
  if (!adminKey) {
    console.warn('[AdminSession] NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY not set');
    return null;
  }

  try {
    // Validate it's a valid address format
    if (!adminKey.startsWith('0x') || adminKey.length !== 42) {
      console.error('[AdminSession] Invalid admin address format');
      return null;
    }
    return getAddress(adminKey as `0x${string}`); // Checksum address
  } catch (error) {
    console.error('[AdminSession] Failed to validate admin address', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session token issuance and verification
// ─────────────────────────────────────────────────────────────────────────────

function getHmacSecret(): string {
  const secret = process.env.MARKETPLACE_SESSION_KEY ?? 'website-admin-fallback-key';
  if (!secret || secret === 'website-admin-fallback-key') {
    console.warn('[AdminSession] MARKETPLACE_SESSION_KEY not set, using fallback (insecure)');
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

export function issueAdminSessionToken(address: `0x${string}`): string {
  const checksumAddress = getAddress(address);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ADMIN_SESSION_TTL_MS;

  const hmac = computeHmac(checksumAddress, issuedAt, expiresAt);
  return `admin_${checksumAddress.toLowerCase()}_${issuedAt}_${expiresAt}_${hmac}`;
}

export function verifyAdminSessionToken(token: string): AdminSessionData | null {
  try {
    const parts = token.split('_');
    if (parts.length !== 5 || parts[0] !== 'admin') return null;

    const [, addressStr, issuedAtStr, expiresAtStr, providedHmac] = parts;
    const address = `0x${addressStr}` as `0x${string}`;
    const issuedAt = parseInt(issuedAtStr, 10);
    const expiresAt = parseInt(expiresAtStr, 10);

    // Validate timestamp format
    if (isNaN(issuedAt) || isNaN(expiresAt)) return null;

    // Check expiration
    if (Date.now() > expiresAt) {
      console.debug('[AdminSession] Token expired', { address, expiresAt });
      return null;
    }

    // Verify HMAC
    const expectedHmac = computeHmac(address, issuedAt, expiresAt);
    if (providedHmac !== expectedHmac) {
      console.warn('[AdminSession] Token HMAC mismatch', { address });
      return null;
    }

    // Verify address matches admin
    const adminAddress = getAdminAddress();
    if (!adminAddress || address.toLowerCase() !== adminAddress.toLowerCase()) {
      console.warn('[AdminSession] Token address does not match admin', { address, adminAddress });
      return null;
    }

    return { address, issuedAt, expiresAt };
  } catch (error) {
    console.error('[AdminSession] Failed to verify token', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SIWE Message Verification
// ─────────────────────────────────────────────────────────────────────────────

export async function verifySIWESignature(
  address: `0x${string}`,
  message: string,
  signature: string
): Promise<boolean> {
  try {
    const isValid = await verifyMessage({
      address,
      message,
      signature: signature as `0x${string}`,
    });

    // verifyMessage returns boolean
    return isValid;
  } catch (error) {
    console.error('[AdminSession] SIWE signature verification failed', error);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookie helpers
// ─────────────────────────────────────────────────────────────────────────────

export function buildAdminSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return [
    `${ADMIN_SESSION_COOKIE_NAME}=${token}`,
    'HttpOnly',
    secure,
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${ADMIN_SESSION_TTL_SECONDS}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearAdminSessionCookie(): string {
  return `${ADMIN_SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`;
}
