/**
 * OAuth 2.0 Token Utilities
 * Supports Authorization Code and Client Credentials flows for ChatGPT MCP connection.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const ACCESS_TOKEN_PREFIX = 'satv1';
const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const ACCESS_TOKEN_TTL_SECONDS = 3600;

// In-memory store for one-time authorization codes (short-lived, no persistence needed)
const pendingCodes = new Map<string, { clientId: string; expiresAt: number }>();

export function getOAuthClientId(): string {
  return process.env.OAUTH_CLIENT_ID ?? 'sentinai-mcp';
}

export function getOAuthClientSecret(): string {
  return process.env.OAUTH_CLIENT_SECRET ?? process.env.SENTINAI_API_KEY ?? '';
}

export function issueAuthCode(clientId: string): string {
  const code = randomBytes(24).toString('hex');
  pendingCodes.set(code, { clientId, expiresAt: Date.now() + AUTH_CODE_TTL_MS });
  return code;
}

export function consumeAuthCode(code: string, clientId: string): boolean {
  const entry = pendingCodes.get(code);
  pendingCodes.delete(code); // always remove (one-time use)
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) return false;
  return entry.clientId === clientId;
}

export function deriveAccessToken(secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update('sentinai-mcp-access-token');
  return `${ACCESS_TOKEN_PREFIX}_${hmac.digest('hex')}`;
}

export function validateBearerToken(token: string): boolean {
  const secret = getOAuthClientSecret();
  if (!secret || !token) return false;
  const expected = deriveAccessToken(secret);
  if (expected.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
