/**
 * OAuth 2.0 Token Utilities
 * Supports Authorization Code + PKCE (ChatGPT) and Client Credentials flows.
 * Also handles Dynamic Client Registration (DCR) required by ChatGPT Apps SDK.
 *
 * Storage: Redis (if REDIS_URL is set) or in-memory fallback.
 * Redis persistence prevents token loss on server restart.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import Redis from 'ioredis';
import logger from '@/lib/logger';

const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const AUTH_CODE_TTL_SECONDS = 300;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const DYNAMIC_CLIENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DYNAMIC_CLIENT_TTL_SECONDS = 86400;

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
// Internal data structures
// ---------------------------------------------------------------------------

interface AuthCodeEntry {
  clientId: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  expiresAt: number;
}

interface DynamicClient {
  clientSecret: string;
  redirectUris: string[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// OAuthStore interface (internal)
// ---------------------------------------------------------------------------

interface OAuthStore {
  setAccessToken(token: string, expiresAt: number): Promise<void>;
  getAccessToken(token: string): Promise<{ expiresAt: number } | null>;
  setAuthCode(code: string, entry: AuthCodeEntry): Promise<void>;
  getAndDeleteAuthCode(code: string): Promise<AuthCodeEntry | null>;
  setDynamicClient(clientId: string, client: DynamicClient): Promise<void>;
  getDynamicClientById(clientId: string): Promise<DynamicClient | null>;
}

// ---------------------------------------------------------------------------
// InMemory implementation
// ---------------------------------------------------------------------------

class InMemoryOAuthStore implements OAuthStore {
  private tokens = new Map<string, { expiresAt: number }>();
  private codes = new Map<string, AuthCodeEntry>();
  private clients = new Map<string, DynamicClient>();

  async setAccessToken(token: string, expiresAt: number): Promise<void> {
    this.tokens.set(token, { expiresAt });
  }

  async getAccessToken(token: string): Promise<{ expiresAt: number } | null> {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.tokens.delete(token);
      return null;
    }
    return entry;
  }

  async setAuthCode(code: string, entry: AuthCodeEntry): Promise<void> {
    this.codes.set(code, entry);
  }

  async getAndDeleteAuthCode(code: string): Promise<AuthCodeEntry | null> {
    const entry = this.codes.get(code) ?? null;
    this.codes.delete(code); // one-time use
    return entry;
  }

  async setDynamicClient(clientId: string, client: DynamicClient): Promise<void> {
    this.clients.set(clientId, client);
  }

  async getDynamicClientById(clientId: string): Promise<DynamicClient | null> {
    const client = this.clients.get(clientId);
    if (!client) return null;
    if (Date.now() - client.createdAt > DYNAMIC_CLIENT_TTL_MS) {
      this.clients.delete(clientId);
      return null;
    }
    return client;
  }
}

// ---------------------------------------------------------------------------
// Redis implementation
// ---------------------------------------------------------------------------

class RedisOAuthStore implements OAuthStore {
  private client: Redis;
  private readonly prefix = 'sentinai:oauth:';

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      connectTimeout: 5000,
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    this.client.on('connect', () => {
      logger.info('[OAuth Store] Redis connected');
    });
    this.client.on('error', (err: Error) => {
      logger.error('[OAuth Store] Redis error:', err.message);
    });

    this.client.connect().catch((err: Error) => {
      logger.error('[OAuth Store] Initial connection failed:', err.message);
    });
  }

  private key(type: string, id: string): string {
    return `${this.prefix}${type}:${id}`;
  }

  async setAccessToken(token: string, expiresAt: number): Promise<void> {
    const ttl = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
    try {
      await this.client.setex(this.key('token', token), ttl, JSON.stringify({ expiresAt }));
    } catch (err) {
      logger.error('[OAuth Store] setAccessToken failed:', (err as Error).message);
    }
  }

  async getAccessToken(token: string): Promise<{ expiresAt: number } | null> {
    try {
      const raw = await this.client.get(this.key('token', token));
      if (!raw) return null;
      return JSON.parse(raw) as { expiresAt: number };
    } catch (err) {
      logger.error('[OAuth Store] getAccessToken failed:', (err as Error).message);
      return null;
    }
  }

  async setAuthCode(code: string, entry: AuthCodeEntry): Promise<void> {
    const ttl = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    try {
      await this.client.setex(this.key('code', code), ttl, JSON.stringify(entry));
    } catch (err) {
      logger.error('[OAuth Store] setAuthCode failed:', (err as Error).message);
    }
  }

  async getAndDeleteAuthCode(code: string): Promise<AuthCodeEntry | null> {
    const k = this.key('code', code);
    try {
      // Atomic get + delete to prevent replay attacks
      const results = await this.client.multi().get(k).del(k).exec();
      const raw = results?.[0]?.[1] as string | null;
      if (!raw) return null;
      return JSON.parse(raw) as AuthCodeEntry;
    } catch (err) {
      logger.error('[OAuth Store] getAndDeleteAuthCode failed:', (err as Error).message);
      return null;
    }
  }

  async setDynamicClient(clientId: string, client: DynamicClient): Promise<void> {
    try {
      await this.client.setex(
        this.key('client', clientId),
        DYNAMIC_CLIENT_TTL_SECONDS,
        JSON.stringify(client)
      );
    } catch (err) {
      logger.error('[OAuth Store] setDynamicClient failed:', (err as Error).message);
    }
  }

  async getDynamicClientById(clientId: string): Promise<DynamicClient | null> {
    try {
      const raw = await this.client.get(this.key('client', clientId));
      if (!raw) return null;
      return JSON.parse(raw) as DynamicClient;
    } catch (err) {
      logger.error('[OAuth Store] getDynamicClient failed:', (err as Error).message);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

const globalForOAuth = globalThis as unknown as { __sentinai_oauth_store?: OAuthStore };

function getOAuthStore(): OAuthStore {
  if (globalForOAuth.__sentinai_oauth_store) return globalForOAuth.__sentinai_oauth_store;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    logger.info('[OAuth Store] Using Redis for OAuth token persistence');
    globalForOAuth.__sentinai_oauth_store = new RedisOAuthStore(redisUrl);
  } else {
    logger.info('[OAuth Store] Using InMemory (tokens lost on restart; set REDIS_URL for persistence)');
    globalForOAuth.__sentinai_oauth_store = new InMemoryOAuthStore();
  }

  return globalForOAuth.__sentinai_oauth_store;
}

// ---------------------------------------------------------------------------
// Dynamic Client Registration (DCR) — RFC 7591
// ChatGPT registers a fresh client on each connection.
// ---------------------------------------------------------------------------

export async function registerDynamicClient(
  redirectUris: string[]
): Promise<{ clientId: string; clientSecret: string }> {
  const clientId = `dcr_${randomBytes(12).toString('hex')}`;
  const clientSecret = randomBytes(32).toString('hex');
  await getOAuthStore().setDynamicClient(clientId, { clientSecret, redirectUris, createdAt: Date.now() });
  return { clientId, clientSecret };
}

export async function getDynamicClient(clientId: string): Promise<DynamicClient | null> {
  return getOAuthStore().getDynamicClientById(clientId);
}

/** Returns true if clientId is a valid DCR client with matching secret. */
export async function validateDynamicClient(clientId: string, clientSecret: string): Promise<boolean> {
  const client = await getDynamicClient(clientId);
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

export async function issueAuthCode(
  clientId: string,
  codeChallenge?: string,
  codeChallengeMethod?: string
): Promise<string> {
  const code = randomBytes(24).toString('hex');
  await getOAuthStore().setAuthCode(code, {
    clientId,
    codeChallenge,
    codeChallengeMethod,
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
  });
  return code;
}

/** Consumes the auth code and verifies the PKCE code_verifier (S256). */
export async function consumeAuthCode(
  code: string,
  clientId: string,
  codeVerifier?: string
): Promise<boolean> {
  const entry = await getOAuthStore().getAndDeleteAuthCode(code);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) return false;
  if (entry.clientId !== clientId) return false;

  if (entry.codeChallenge) {
    if (!codeVerifier) return false;
    const computed = createHash('sha256').update(codeVerifier).digest('base64url');
    return computed === entry.codeChallenge;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Access Tokens — persisted in Redis or in-memory
// ---------------------------------------------------------------------------

export async function issueAccessToken(): Promise<string> {
  const token = `satv1_${randomBytes(32).toString('hex')}`;
  await getOAuthStore().setAccessToken(token, Date.now() + ACCESS_TOKEN_TTL_MS);
  return token;
}

/**
 * Validate a Bearer token.
 * Checks (in order):
 *   1. Random token issued via issueAccessToken() — stored in Redis or memory
 *   2. Legacy HMAC-derived token from the static secret
 */
export async function validateBearerToken(token: string): Promise<boolean> {
  if (!token) return false;

  // 1. Check store-backed tokens (Redis or InMemory)
  const entry = await getOAuthStore().getAccessToken(token);
  if (entry) {
    if (Date.now() > entry.expiresAt) return false;
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

// suppress unused variable warnings for TTL constants used only in computation
void AUTH_CODE_TTL_SECONDS;
