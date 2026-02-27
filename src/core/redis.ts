/**
 * Core Redis Client
 * Lightweight singleton Redis connection for src/core modules.
 * Separate from the main IStateStore to avoid coupling core types to legacy store interface.
 *
 * Falls back to null (in-memory mode) when REDIS_URL is not configured.
 */

import Redis from 'ioredis';
import logger from '@/lib/logger';

// globalThis singleton — survives Next.js Turbopack module re-evaluation
const g = globalThis as unknown as { __sentinai_core_redis?: Redis | null };

/**
 * Returns a shared Redis client for core modules, or null if REDIS_URL is not set.
 * Callers must implement in-memory fallback when this returns null.
 */
export function getCoreRedis(): Redis | null {
  if ('__sentinai_core_redis' in g) return g.__sentinai_core_redis ?? null;

  const url = process.env.REDIS_URL;
  if (!url) {
    g.__sentinai_core_redis = null;
    return null;
  }

  const client = new Redis(url, {
    connectTimeout: 5000,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  client.on('connect', () => logger.info('[Core Redis] Connected'));
  client.on('error', (err) => logger.error('[Core Redis] Error:', err.message));

  client.connect().catch((err) => {
    logger.error('[Core Redis] Initial connection failed:', err.message);
  });

  g.__sentinai_core_redis = client;
  return client;
}

/** Reset for testing */
export async function resetCoreRedis(): Promise<void> {
  if (g.__sentinai_core_redis) {
    await g.__sentinai_core_redis.quit().catch(() => {});
    delete (g as Record<string, unknown>).__sentinai_core_redis;
  }
}
