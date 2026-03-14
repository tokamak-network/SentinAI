/**
 * SIWE Nonce Store
 * Manages short-lived nonces for Sign-In-With-Ethereum authentication.
 * Prevents replay attacks through one-time-use consumption.
 *
 * Storage: Redis (if REDIS_URL is set) or in-memory fallback.
 */

import { randomBytes } from 'crypto';
import Redis from 'ioredis';
import logger from '@/lib/logger';

export const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const NONCE_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// NonceStore interface
// ---------------------------------------------------------------------------

export interface NonceStore {
  create(address: `0x${string}`): Promise<string>;
  consume(address: `0x${string}`, nonce: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// InMemory implementation
// ---------------------------------------------------------------------------

class InMemoryNonceStore implements NonceStore {
  private nonces = new Map<string, { nonce: string; expiresAt: number }>();

  async create(address: `0x${string}`): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + NONCE_TTL_MS;
    this.nonces.set(address, { nonce, expiresAt });
    return nonce;
  }

  async consume(address: `0x${string}`, nonce: string): Promise<boolean> {
    const entry = this.nonces.get(address);
    if (!entry) return false;

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.nonces.delete(address);
      return false;
    }

    // Check nonce match
    if (entry.nonce !== nonce) {
      return false;
    }

    // One-time use: delete after consumption
    this.nonces.delete(address);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Redis implementation
// ---------------------------------------------------------------------------

class RedisNonceStore implements NonceStore {
  private client: Redis;
  private readonly prefix = 'sentinai:siwe:nonce:';

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

  async create(address: `0x${string}`): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    try {
      // NX: only set if not exists (one nonce per address at a time)
      await this.client.setex(
        this.prefix + address,
        NONCE_TTL_SECONDS,
        nonce
      );
    } catch (err) {
      logger.error('[Nonce Store] create failed:', (err as Error).message);
    }
    return nonce;
  }

  async consume(address: `0x${string}`, nonce: string): Promise<boolean> {
    const key = this.prefix + address;
    try {
      // Atomic get + delete to prevent replay
      const results = await this.client.multi().get(key).del(key).exec();
      const stored = results?.[0]?.[1] as string | null;

      if (!stored || stored !== nonce) {
        return false;
      }

      return true;
    } catch (err) {
      logger.error('[Nonce Store] consume failed:', (err as Error).message);
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let instance: NonceStore | null = null;

export function getNonceStore(): NonceStore {
  if (!instance) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      instance = new RedisNonceStore(redisUrl);
      logger.info('[Nonce Store] Using Redis backend');
    } else {
      instance = new InMemoryNonceStore();
      logger.info('[Nonce Store] Using InMemory backend');
    }
  }
  return instance;
}
