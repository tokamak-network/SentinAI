import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = new Map<string, string[]>();

  return {
    state,
    redisCtorMock: vi.fn(),
    redisRpushMock: vi.fn(async (key: string, value: string) => {
      const current = state.get(key) ?? [];
      current.push(value);
      state.set(key, current);
      return current.length;
    }),
    redisLrangeMock: vi.fn(async (key: string, start: number, end: number) => {
      const current = state.get(key) ?? [];
      const normalizedEnd = end < 0 ? current.length + end + 1 : end + 1;
      return current.slice(start, normalizedEnd);
    }),
    redisLtrimMock: vi.fn(async (key: string, start: number, end: number) => {
      const current = state.get(key) ?? [];
      const normalizedEnd = end < 0 ? current.length + end + 1 : end + 1;
      state.set(key, current.slice(start, normalizedEnd));
      return 'OK';
    }),
    redisDelMock: vi.fn(async (key: string) => {
      state.delete(key);
      return 1;
    }),
  };
});

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation((...args: unknown[]) => {
    hoisted.redisCtorMock(...args);

    return {
      rpush: hoisted.redisRpushMock,
      lrange: hoisted.redisLrangeMock,
      ltrim: hoisted.redisLtrimMock,
      del: hoisted.redisDelMock,
    };
  }),
}));

const {
  appendAgentMarketplaceBatchHistory,
  clearAgentMarketplaceBatchHistory,
  getAgentMarketplaceBatchHistory,
} = await import('@/lib/agent-marketplace/batch-history-store');

describe('agent-marketplace batch-history-store', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    hoisted.state.clear();
    delete process.env.REDIS_URL;
    (globalThis as typeof globalThis & {
      __sentinai_agent_marketplace_batch_history_redis?: unknown;
    }).__sentinai_agent_marketplace_batch_history_redis = undefined;
    await clearAgentMarketplaceBatchHistory();
  });

  it('fails closed when REDIS_URL is missing', async () => {
    await expect(getAgentMarketplaceBatchHistory()).rejects.toThrow('REDIS_URL is required');
    await expect(
      appendAgentMarketplaceBatchHistory({
        status: 'success',
        publishedAt: '2026-03-13T00:10:00.000Z',
        window: {
          fromIso: '2026-03-12T00:00:00.000Z',
          toIso: '2026-03-12T23:59:59.999Z',
        },
        batchHash: 'QmBatchCid',
        txHash: '0xtxhash',
        merkleRoot: '0x' + 'a'.repeat(64),
        error: null,
      })
    ).rejects.toThrow('REDIS_URL is required');
  });

  it('returns newest-first history after appending records', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    await appendAgentMarketplaceBatchHistory({
      status: 'failed',
      publishedAt: '2026-03-12T00:10:00.000Z',
      window: {
        fromIso: '2026-03-11T00:00:00.000Z',
        toIso: '2026-03-11T23:59:59.999Z',
      },
      batchHash: null,
      txHash: null,
      merkleRoot: null,
      error: 'submit failed',
    });
    await appendAgentMarketplaceBatchHistory({
      status: 'success',
      publishedAt: '2026-03-13T00:10:00.000Z',
      window: {
        fromIso: '2026-03-12T00:00:00.000Z',
        toIso: '2026-03-12T23:59:59.999Z',
      },
      batchHash: 'QmBatchCid',
      txHash: '0xtxhash',
      merkleRoot: '0x' + 'a'.repeat(64),
      error: null,
    });

    const history = await getAgentMarketplaceBatchHistory();

    expect(history).toHaveLength(2);
    expect(history[0].status).toBe('success');
    expect(history[0].batchHash).toBe('QmBatchCid');
    expect(history[1].status).toBe('failed');
    expect(history[1].error).toBe('submit failed');
  });

  it('trims history to the latest 50 records', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    for (let index = 0; index < 55; index += 1) {
      await appendAgentMarketplaceBatchHistory({
        status: 'success',
        publishedAt: `2026-03-13T00:${index.toString().padStart(2, '0')}:00.000Z`,
        window: {
          fromIso: '2026-03-12T00:00:00.000Z',
          toIso: '2026-03-12T23:59:59.999Z',
        },
        batchHash: `QmBatchCid${index}`,
        txHash: `0xtxhash${index}`,
        merkleRoot: `0x${index.toString(16).padStart(64, '0')}`,
        error: null,
      });
    }

    const history = await getAgentMarketplaceBatchHistory();

    expect(history).toHaveLength(50);
    expect(history[0].batchHash).toBe('QmBatchCid54');
    expect(history[49].batchHash).toBe('QmBatchCid5');
  });
});
