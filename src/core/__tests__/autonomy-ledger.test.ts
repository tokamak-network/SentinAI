/**
 * Unit Tests for Autonomy Ledger
 * Tests InMemoryAutonomyLedger — append, query, filtering, capacity capping.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAutonomyLedger, setLedger, resetLedger, getLedger } from '@/core/autonomy-ledger';
import type { LedgerEntry } from '@/types/autonomy-ledger';

// ============================================================
// Helpers
// ============================================================

function makeEntry(
  kind: LedgerEntry['kind'],
  overrides: Partial<Omit<LedgerEntry, 'id' | 'timestamp'>> = {}
): Omit<LedgerEntry, 'id' | 'timestamp'> {
  return { kind, agent: 'test-agent', action: 'restart_pod', ...overrides };
}

// ============================================================
// InMemoryAutonomyLedger
// ============================================================

describe('InMemoryAutonomyLedger', () => {
  let ledger: InMemoryAutonomyLedger;

  beforeEach(() => {
    ledger = new InMemoryAutonomyLedger();
  });

  it('appends an entry and returns it with id and timestamp', async () => {
    const entry = await ledger.append(makeEntry('action_executed'));
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
    expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
    expect(entry.kind).toBe('action_executed');
    expect(entry.agent).toBe('test-agent');
  });

  it('query returns entries newest-first', async () => {
    await ledger.append(makeEntry('decision_taken'));
    await new Promise(r => setTimeout(r, 5));
    await ledger.append(makeEntry('action_executed'));
    const entries = await ledger.query();
    expect(entries[0].kind).toBe('action_executed');
    expect(entries[1].kind).toBe('decision_taken');
  });

  it('query filters by kind', async () => {
    await ledger.append(makeEntry('action_executed'));
    await ledger.append(makeEntry('guardrail_blocked'));
    await ledger.append(makeEntry('action_executed'));
    const results = await ledger.query({ kind: 'guardrail_blocked' });
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('guardrail_blocked');
  });

  it('query filters by agent', async () => {
    await ledger.append(makeEntry('action_executed', { agent: 'executor-agent' }));
    await ledger.append(makeEntry('action_executed', { agent: 'remediation-engine' }));
    const results = await ledger.query({ agent: 'executor-agent' });
    expect(results).toHaveLength(1);
    expect(results[0].agent).toBe('executor-agent');
  });

  it('query filters by since', async () => {
    await ledger.append(makeEntry('action_executed'));
    const mid = new Date().toISOString();
    await new Promise(r => setTimeout(r, 10));
    await ledger.append(makeEntry('guardrail_blocked'));
    const results = await ledger.query({ since: mid });
    expect(results.every(e => e.timestamp >= mid)).toBe(true);
    expect(results.some(e => e.kind === 'guardrail_blocked')).toBe(true);
  });

  it('query respects limit', async () => {
    for (let i = 0; i < 10; i++) await ledger.append(makeEntry('action_executed'));
    const results = await ledger.query({ limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('query clamps limit at 500', async () => {
    for (let i = 0; i < 5; i++) await ledger.append(makeEntry('action_executed'));
    const results = await ledger.query({ limit: 9999 });
    expect(results.length).toBeLessThanOrEqual(500);
  });

  it('stores suppression reason', async () => {
    const entry = await ledger.append(makeEntry('action_suppressed', {
      suppressionReason: 'simulation_mode',
    }));
    const results = await ledger.query({ kind: 'action_suppressed' });
    expect(results[0].suppressionReason).toBe('simulation_mode');
    expect(results[0].id).toBe(entry.id);
  });

  it('clear() removes all entries', async () => {
    await ledger.append(makeEntry('action_executed'));
    ledger.clear();
    const results = await ledger.query();
    expect(results).toHaveLength(0);
  });
});

// ============================================================
// Singleton
// ============================================================

describe('getLedger singleton', () => {
  beforeEach(() => {
    resetLedger();
  });

  it('returns InMemoryAutonomyLedger when REDIS_URL is not set', () => {
    const original = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    const ledger = getLedger();
    expect(ledger).toBeInstanceOf(InMemoryAutonomyLedger);
    process.env.REDIS_URL = original;
  });

  it('returns same instance on repeated calls', () => {
    const a = getLedger();
    const b = getLedger();
    expect(a).toBe(b);
  });

  it('setLedger overrides the singleton', async () => {
    const custom = new InMemoryAutonomyLedger();
    setLedger(custom);
    const entry = await getLedger().append(makeEntry('fallback_triggered'));
    const results = await custom.query();
    expect(results.some(e => e.id === entry.id)).toBe(true);
  });
});
