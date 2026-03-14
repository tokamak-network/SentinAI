/**
 * SIWE Nonce Storage
 * Supports Redis (if REDIS_URL is set) or in-memory fallback.
 * Used for Sign-In-With-Ethereum challenge generation and verification.
 *
 * Storage: Redis (if REDIS_URL is set) or in-memory fallback.
 * Redis persistence prevents nonce reuse attacks across server restarts.
 */

import { randomBytes } from 'crypto';
import Redis from 'ioredis';
import logger from '@/lib/logger';

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const NONCE_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// NonceStore interface
// ---------------------------------------------------------------------------

export interface NonceStore {
  /**
   * Generate and store a new nonce for the given Ethereum address.
   * Returns a random 32-byte hex string.
   * @param address Ethereum address (0x-prefixed)
   * @returns Random 32-byte hex nonce
   */
  create(address: `0x${string}`): Promise<string>;

  /**
   * Consume a nonce atomically (get and delete).
   * Returns true only if the nonce exists and has not expired.
   * Returns false if the nonce does not exist, has already been consumed, or has expired.
   * @param address Ethereum address (0x-prefixed)
   * @param nonce The nonce to consume
   * @returns true if consumed, false if already consumed or expired
   */
  consume(address: `0x${string}`, nonce: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// InMemory implementation
// ---------------------------------------------------------------------------

class InMemoryNonceStore implements NonceStore {
  private nonces = new Map<string, { nonce: string; expiresAt: number }>();

  /**
   * Generate a key from address for storage.
   */
  private key(address: `0x${string}`): string {
    return `nonce:${address.toLowerCase()}`;
  }

  async create(address: `0x${string}`): Promise<string> {
    const nonce = randomBytes(32).toString('hex');
    const k = this.key(address);
    this.nonces.set(k, {
      nonce,
      expiresAt: Date.now() + NONCE_TTL_MS,
    });
    return nonce;
  }

  async consume(address: `0x${string}`, nonce: string): Promise<boolean> {
    const k = this.key(address);
    const entry = this.nonces.get(k);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.nonces.delete(k);
      return false;
    }
    if (entry.nonce !== nonce) return false;
    this.nonces.delete(k); // one-time use
    return true;
  }
}

// ---------------------------------------------------------------------------
// Redis implementation
// ---------------------------------------------------------------------------

class RedisNonceStore implements NonceStore {
  private client: Redis;
  private readonly prefix = 'sentinai:siwe:';

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
      logger.info('[Nonce Store] Redis connected');
    });
    this.client.on('error', (err: Error) => {
      logger.error('[Nonce Store] Redis error:', err.message);
    });

    this.client.connect().catch((err: Error) => {
      logger.error('[Nonce Store] Initial connection failed:', err.message);
    });
  }

  private key(address: `0x${string}`): string {
    return `${this.prefix}nonce:${address.toLowerCase()}`;
  }

  async create(address: `0x${string}`): Promise<string> {
    const nonce = randomBytes(32).toString('hex');
    const k = this.key(address);
    try {
      await this.client.setex(k, NONCE_TTL_SECONDS, nonce);
    } catch (err) {
      logger.error('[Nonce Store] create failed:', (err as Error).message);
    }
    return nonce;
  }

  async consume(address: `0x${string}`, nonce: string): Promise<boolean> {
    const k = this.key(address);
    try {
      // Atomic get + delete to prevent replay attacks
      const results = await this.client.multi().get(k).del(k).exec();
      const stored = results?.[0]?.[1] as string | null;
      if (!stored) return false;
      return stored === nonce;
    } catch (err) {
      logger.error('[Nonce Store] consume failed:', (err as Error).message);
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

const globalForNonce = globalThis as unknown as { __sentinai_nonce_store?: NonceStore };

function getNonceStore(): NonceStore {
  if (globalForNonce.__sentinai_nonce_store) return globalForNonce.__sentinai_nonce_store;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    logger.info('[Nonce Store] Using Redis for SIWE nonce persistence');
    globalForNonce.__sentinai_nonce_store = new RedisNonceStore(redisUrl);
  } else {
    logger.info(
      '[Nonce Store] Using InMemory (nonces lost on restart; set REDIS_URL for persistence)'
    );
    globalForNonce.__sentinai_nonce_store = new InMemoryNonceStore();
  }

  return globalForNonce.__sentinai_nonce_store;
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Create a new nonce for SIWE authentication.
 * @param address Ethereum address (0x-prefixed)
 * @returns Random 32-byte hex nonce
 */
export async function createNonce(address: `0x${string}`): Promise<string> {
  return getNonceStore().create(address);
}

/**
 * Consume a nonce for SIWE authentication.
 * Returns true only if the nonce exists, matches, and has not expired.
 * The nonce is atomically deleted to prevent replay attacks.
 * @param address Ethereum address (0x-prefixed)
 * @param nonce The nonce to validate
 * @returns true if valid and consumed, false if invalid or already consumed
 */
export async function consumeNonce(address: `0x${string}`, nonce: string): Promise<boolean> {
  return getNonceStore().consume(address, nonce);
}

/**
 * Singleton nonce store instance (for testing)
 */
export const nonceStore: NonceStore = getNonceStore();

// suppress unused variable warnings
void NONCE_TTL_SECONDS;
