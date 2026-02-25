/**
 * OAuth 2.0 Token Utilities
 * Supports Authorization Code + PKCE (ChatGPT) and Client Credentials flows.
 * Also handles Dynamic Client Registration (DCR) required by ChatGPT Apps SDK.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const DYNAMIC_CLIENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const ACCESS_TOKEN_TTL_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Static (pre-configured) client — for direct API key / HMAC-derived tokens
// ---------------------------------------------------------------------------

export function getOAuthClientId(): string {
  return process.env.OAUTH_CLIENT_ID ?? 'sentinai-mcp';
}

export function getOAuthClientSecret(): string {
  return process.env.OAUTH_CLIENT_SECRET ?? process.env.SENTINAI_API_KEY ?? '';
}

/** Derive a deterministic Bearer token from the static secret (legacy support). */
export function deriveAccessToken(secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update('sentinai-mcp-access-token');
  return `satv1_${hmac.digest('hex')}`;
}

// ---------------------------------------------------------------------------
// Dynamic Client Registration (DCR) — RFC 7591
// ChatGPT registers a fresh client on each connection.
// ---------------------------------------------------------------------------

interface DynamicClient {
  clientSecret: string;
  redirectUris: string[];
  createdAt: number;
}

const dynamicClients = new Map<string, DynamicClient>();

export function registerDynamicClient(redirectUris: string[]): { clientId: string; clientSecret: string } {
  const clientId = `dcr_${randomBytes(12).toString('hex')}`;
  const clientSecret = randomBytes(32).toString('hex');
  dynamicClients.set(clientId, { clientSecret, redirectUris, createdAt: Date.now() });
  return { clientId, clientSecret };
}

export function getDynamicClient(clientId: string): DynamicClient | undefined {
  const client = dynamicClients.get(clientId);
  if (!client) return undefined;
  // Expire stale clients
  if (Date.now() - client.createdAt > DYNAMIC_CLIENT_TTL_MS) {
    dynamicClients.delete(clientId);
    return undefined;
  }
  return client;
}

/** Returns true if clientId is a valid DCR client with matching secret. */
export function validateDynamicClient(clientId: string, clientSecret: string): boolean {
  const client = getDynamicClient(clientId);
  if (!client) return false;
  try {
    const a = Buffer.from(client.clientSecret);
    const b = Buffer.from(clientSecret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Authorization Codes with PKCE — RFC 7636
// ---------------------------------------------------------------------------

interface AuthCodeEntry {
  clientId: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  expiresAt: number;
}

const pendingCodes = new Map<string, AuthCodeEntry>();

export function issueAuthCode(
  clientId: string,
  codeChallenge?: string,
  codeChallengeMethod?: string
): string {
  const code = randomBytes(24).toString('hex');
  pendingCodes.set(code, {
    clientId,
    codeChallenge,
    codeChallengeMethod,
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
  });
  return code;
}

/** Consumes the auth code and verifies the PKCE code_verifier (S256). */
export function consumeAuthCode(
  code: string,
  clientId: string,
  codeVerifier?: string
): boolean {
  const entry = pendingCodes.get(code);
  pendingCodes.delete(code); // one-time use
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) return false;
  if (entry.clientId !== clientId) return false;

  if (entry.codeChallenge) {
    // PKCE was requested — verifier is required
    if (!codeVerifier) return false;
    const computed = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url'); // RFC 7636 S256 challenge
    return computed === entry.codeChallenge;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Access Tokens — random, stored in memory
// ---------------------------------------------------------------------------

interface AccessTokenEntry {
  expiresAt: number;
}

const issuedTokens = new Map<string, AccessTokenEntry>();

export function issueAccessToken(): string {
  const token = `satv1_${randomBytes(32).toString('hex')}`;
  issuedTokens.set(token, { expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS });
  return token;
}

/**
 * Validate a Bearer token.
 * Checks (in order):
 *   1. Random token issued via issueAccessToken()
 *   2. Legacy HMAC-derived token from the static secret
 */
export function validateBearerToken(token: string): boolean {
  if (!token) return false;

  // 1. Check randomly-issued tokens
  const entry = issuedTokens.get(token);
  if (entry) {
    if (Date.now() > entry.expiresAt) {
      issuedTokens.delete(token);
      return false;
    }
    return true;
  }

  // 2. Legacy: HMAC-derived token from static client secret
  const secret = getOAuthClientSecret();
  if (!secret) return false;
  const expected = deriveAccessToken(secret);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
