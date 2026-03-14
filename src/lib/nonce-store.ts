/**
 * SIWE (Sign-In with Ethereum) Nonce Store
 * Manages nonces for replay attack prevention.
 * 1-use-per-nonce pattern: create() → consume() → deleted
 * Storage: Redis (persistent) or InMemory (fallback)
 */

import { randomBytes } from 'crypto';
import Redis from 'ioredis';
import logger from '@/lib/logger';

export const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const NONCE_TTL_SECONDS = 300;

export interface NonceStore {
  create(address: `0x${string}`): Promise<string>;
  consume(address: `0x${string}`, nonce: string): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// InMemory implementation
// ─────────────────────────────────────────────────────────────────────────────

class InMemoryNonceStore implements NonceStore {
  private nonces = new Map<string, { nonce: string; expiresAt: number }>();

  async create(address: `0x${string}`): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + NONCE_TTL_MS;
    this.nonces.set(this.key(address), { nonce, expiresAt });
    return nonce;
  }

  async consume(address: `0x${string}`, nonce: string): Promise<boolean> {
    const key = this.key(address);
    const entry = this.nonces.get(key);

    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.nonces.delete(key);
      return false;
    }
    if (entry.nonce !== nonce) return false;

    // Consumed: delete immediately
    this.nonces.delete(key);
    return true;
  }

  private key(address: `0x${string}`): string {
    return `siwe:nonce:${address.toLowerCase()}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Redis implementation
// ─────────────────────────────────────────────────────────────────────────────

class RedisNonceStore implements NonceStore {
  constructor(private redis: Redis) {}

  async create(address: `0x${string}`): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    const key = this.key(address);
    await this.redis.setex(key, NONCE_TTL_SECONDS, nonce);
    return nonce;
  }

  async consume(address: `0x${string}`, nonce: string): Promise<boolean> {
    const key = this.key(address);
    const stored = await this.redis.getdel(key);
    return stored === nonce;
  }

  private key(address: `0x${string}`): string {
    return `siwe:nonce:${address.toLowerCase()}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton factory
// ─────────────────────────────────────────────────────────────────────────────

let instance: NonceStore | null = null;

export function getNonceStore(): NonceStore {
  if (instance) return instance;

  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    try {
      const redis = new Redis(redisUrl);
      instance = new RedisNonceStore(redis);
      logger.info('[NonceStore] Using Redis backend');
      return instance;
    } catch (error) {
      logger.warn('[NonceStore] Redis initialization failed, falling back to InMemory', error);
    }
  }

  instance = new InMemoryNonceStore();
  logger.info('[NonceStore] Using InMemory backend (non-persistent)');
  return instance;
}
