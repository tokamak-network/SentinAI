import { describe, expect, it } from 'vitest';
import { parseSyncStatus, getValueByPath } from '@/lib/client-profile/sync-parsers';

// ─── getValueByPath ──────────────────────────────────────────────────────────

describe('getValueByPath', () => {
  it('returns the value at a simple key', () => {
    expect(getValueByPath({ block: 42 }, 'block')).toBe(42);
  });

  it('handles nested paths', () => {
    expect(getValueByPath({ result: { data: { block: 100 } } }, 'result.data.block')).toBe(100);
  });

  it('returns undefined for missing path segments', () => {
    expect(getValueByPath({ a: 1 }, 'a.b.c')).toBeUndefined();
  });

  it('returns the object itself for empty path', () => {
    const obj = { x: 1 };
    expect(getValueByPath(obj, '')).toBe(obj);
  });

  it('returns undefined when root is null', () => {
    expect(getValueByPath(null, 'a')).toBeUndefined();
  });
});

// ─── standard parser ─────────────────────────────────────────────────────────

describe('parseSyncStatus — standard', () => {
  it('false response → isSyncing=false, currentBlock=null', () => {
    const result = parseSyncStatus(false, 'standard');
    expect(result.isSyncing).toBe(false);
    expect(result.currentBlock).toBeNull();
    expect(result.highestBlock).toBeNull();
  });

  it('object response → isSyncing=true with block numbers', () => {
    const result = parseSyncStatus(
      { startingBlock: '0x0', currentBlock: '0x64', highestBlock: '0xc8' },
      'standard'
    );
    expect(result.isSyncing).toBe(true);
    expect(result.currentBlock).toBe(100);
    expect(result.highestBlock).toBe(200);
  });

  it('object with decimal numbers', () => {
    const result = parseSyncStatus({ currentBlock: 50, highestBlock: 100 }, 'standard');
    expect(result.currentBlock).toBe(50);
    expect(result.highestBlock).toBe(100);
  });
});

// ─── nethermind parser ───────────────────────────────────────────────────────

describe('parseSyncStatus — nethermind', () => {
  it('correctly extracts currentBlockNumber and isSyncing fields', () => {
    const result = parseSyncStatus(
      { currentBlockNumber: 1500, highestBlockNumber: 2000, isSyncing: true },
      'nethermind'
    );
    expect(result.isSyncing).toBe(true);
    expect(result.currentBlock).toBe(1500);
    expect(result.highestBlock).toBe(2000);
  });

  it('false response → not syncing', () => {
    const result = parseSyncStatus(false, 'nethermind');
    expect(result.isSyncing).toBe(false);
    expect(result.currentBlock).toBeNull();
  });

  it('isSyncing=false in nethermind object', () => {
    const result = parseSyncStatus(
      { currentBlockNumber: 2000, highestBlockNumber: 2000, isSyncing: false },
      'nethermind'
    );
    expect(result.isSyncing).toBe(false);
  });
});

// ─── op-geth parser ──────────────────────────────────────────────────────────

describe('parseSyncStatus — op-geth', () => {
  it('behaves like standard (L2 data comes from separate optimism_syncStatus call)', () => {
    const result = parseSyncStatus(false, 'op-geth');
    expect(result.isSyncing).toBe(false);
  });

  it('object response extracts standard fields', () => {
    const result = parseSyncStatus(
      { currentBlock: '0xa', highestBlock: '0x14' },
      'op-geth'
    );
    expect(result.isSyncing).toBe(true);
    expect(result.currentBlock).toBe(10);
    expect(result.highestBlock).toBe(20);
  });
});

// ─── nitro parser ────────────────────────────────────────────────────────────

describe('parseSyncStatus — nitro', () => {
  it('behaves like standard', () => {
    const result = parseSyncStatus(
      { currentBlock: 300, highestBlock: 400 },
      'nitro'
    );
    expect(result.isSyncing).toBe(true);
    expect(result.currentBlock).toBe(300);
    expect(result.highestBlock).toBe(400);
  });
});

// ─── custom parser ───────────────────────────────────────────────────────────

describe('parseSyncStatus — custom', () => {
  it('uses customPaths to extract values via dot notation', () => {
    const raw = {
      sync: {
        current: 150,
        target: 200,
        active: true,
      },
    };
    const result = parseSyncStatus(raw, 'custom', {
      currentBlockPath: 'sync.current',
      highestBlockPath: 'sync.target',
      isSyncingPath: 'sync.active',
    });
    expect(result.isSyncing).toBe(true);
    expect(result.currentBlock).toBe(150);
    expect(result.highestBlock).toBe(200);
  });

  it('false response → not syncing with custom paths', () => {
    const result = parseSyncStatus(false, 'custom', { isSyncingPath: 'status' });
    expect(result.isSyncing).toBe(false);
  });

  it('handles missing path gracefully with null', () => {
    const result = parseSyncStatus({ a: 1 }, 'custom', {
      currentBlockPath: 'x.y.z',
      highestBlockPath: 'a.b',
    });
    expect(result.currentBlock).toBeNull();
    expect(result.highestBlock).toBeNull();
  });
});
