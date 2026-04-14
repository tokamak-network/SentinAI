/**
 * Autonomy Ledger
 * Append-only audit log of all autonomous pipeline decisions, actions, and guardrail events.
 *
 * Two implementations:
 *   - InMemoryAutonomyLedger  (default / dev / test)
 *   - RedisAutonomyLedger     (production, enabled when REDIS_URL is set)
 *
 * Usage: import { getLedger } from '@/core/autonomy-ledger'
 */

import { randomUUID } from 'crypto';
import type { IAutonomyLedger, LedgerEntry, LedgerQuery } from '@/types/autonomy-ledger';
import logger from '@/lib/logger';

// ============================================================
// Constants
// ============================================================

const MAX_ENTRIES = 10_000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const REDIS_KEY = 'autonomy:ledger';

// ============================================================
// InMemory Implementation
// ============================================================

export class InMemoryAutonomyLedger implements IAutonomyLedger {
  private entries: LedgerEntry[] = [];

  async append(entry: Omit<LedgerEntry, 'id' | 'timestamp'>): Promise<LedgerEntry> {
    const full: LedgerEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.entries.push(full);
    // Trim oldest when over capacity
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(this.entries.length - MAX_ENTRIES);
    }
    return full;
  }

  async query(q: LedgerQuery = {}): Promise<LedgerEntry[]> {
    const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    let result = this.entries.slice();

    if (q.since) {
      const sinceMs = new Date(q.since).getTime();
      result = result.filter(e => new Date(e.timestamp).getTime() >= sinceMs);
    }
    if (q.until) {
      const untilMs = new Date(q.until).getTime();
      result = result.filter(e => new Date(e.timestamp).getTime() < untilMs);
    }
    if (q.kind) {
      result = result.filter(e => e.kind === q.kind);
    }
    if (q.agent) {
      result = result.filter(e => e.agent === q.agent);
    }

    // Return most-recent first
    return result.reverse().slice(0, limit);
  }

  // Test helper — clear all entries
  clear(): void {
    this.entries = [];
  }
}

// ============================================================
// Redis Implementation
// ============================================================

export class RedisAutonomyLedger implements IAutonomyLedger {
  private client: import('ioredis').Redis;

  constructor(client: import('ioredis').Redis) {
    this.client = client;
  }

  async append(entry: Omit<LedgerEntry, 'id' | 'timestamp'>): Promise<LedgerEntry> {
    const full: LedgerEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    try {
      const score = new Date(full.timestamp).getTime();
      await this.client.zadd(REDIS_KEY, score, JSON.stringify(full));
      // Trim to MAX_ENTRIES (keep newest)
      await this.client.zremrangebyrank(REDIS_KEY, 0, -(MAX_ENTRIES + 1));
    } catch (err) {
      logger.error('[AutonomyLedger] Redis append failed:', err);
    }
    return full;
  }

  async query(q: LedgerQuery = {}): Promise<LedgerEntry[]> {
    const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    try {
      const sinceScore = q.since ? new Date(q.since).getTime() : '-inf';
      const untilScore = q.until ? new Date(q.until).getTime() : '+inf';

      // Fetch newest-first using ZREVRANGEBYSCORE
      const raw = await this.client.zrevrangebyscore(
        REDIS_KEY,
        untilScore,
        sinceScore,
        'LIMIT',
        0,
        MAX_LIMIT * 2 // over-fetch to allow in-memory filtering
      );

      const entries: LedgerEntry[] = raw
        .map(s => { try { return JSON.parse(s) as LedgerEntry; } catch { return null; } })
        .filter((e): e is LedgerEntry => e !== null);

      let result = entries;
      if (q.kind) result = result.filter(e => e.kind === q.kind);
      if (q.agent) result = result.filter(e => e.agent === q.agent);

      return result.slice(0, limit);
    } catch (err) {
      logger.error('[AutonomyLedger] Redis query failed:', err);
      return [];
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let _ledger: IAutonomyLedger | null = null;

export function getLedger(): IAutonomyLedger {
  if (_ledger) return _ledger;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      // Lazy import to avoid pulling ioredis in test environments that don't need it
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require('ioredis');
      const client = new Redis(redisUrl, { lazyConnect: false, enableReadyCheck: false });
      _ledger = new RedisAutonomyLedger(client);
      logger.info('[AutonomyLedger] Using Redis backend');
    } catch {
      logger.warn('[AutonomyLedger] Redis init failed — falling back to in-memory');
      _ledger = new InMemoryAutonomyLedger();
    }
  } else {
    _ledger = new InMemoryAutonomyLedger();
  }

  return _ledger;
}

/** Override singleton (for testing) */
export function setLedger(ledger: IAutonomyLedger): void {
  _ledger = ledger;
}

/** Reset singleton (for testing) */
export function resetLedger(): void {
  _ledger = null;
}
