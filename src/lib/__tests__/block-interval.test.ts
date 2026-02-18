import { describe, expect, it, vi } from 'vitest';

vi.mock('@/chains', () => ({
  getChainPlugin: () => ({ expectedBlockIntervalSeconds: 2.0 }),
}));

import { resolveBlockInterval } from '@/lib/block-interval';

describe('block-interval', () => {
  it('preserves seed block interval when provided', () => {
    const interval = resolveBlockInterval({
      currentBlockHeight: BigInt(1000),
      lastBlockHeight: '999',
      lastBlockTime: String(Date.now() - 10_000),
      nowMs: Date.now(),
      seedBlockInterval: 7.5,
    });

    expect(interval).toBe(7.5);
  });

  it('calculates interval from last block state in live mode', () => {
    const nowMs = 1_000_000;
    const interval = resolveBlockInterval({
      currentBlockHeight: BigInt(200),
      lastBlockHeight: '198',
      lastBlockTime: String(nowMs - 8_000),
      nowMs,
    });

    expect(interval).toBe(4);
  });

  it('falls back to default interval when no last block exists', () => {
    const interval = resolveBlockInterval({
      currentBlockHeight: BigInt(100),
      lastBlockHeight: null,
      lastBlockTime: null,
      nowMs: Date.now(),
    });

    expect(interval).toBe(2);
  });
});

