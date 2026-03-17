import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = new Map<string, string>();

  return {
    state,
    redisGetMock: vi.fn(async (key: string) => state.get(key) ?? null),
    redisSetMock: vi.fn(async (key: string, value: string) => {
      state.set(key, value);
      return 'OK';
    }),
    redisDelMock: vi.fn(async (key: string) => {
      state.delete(key);
      return 1;
    }),
    redisCtorMock: vi.fn(),
  };
});

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation((...args: unknown[]) => {
    hoisted.redisCtorMock(...args);

    return {
      get: hoisted.redisGetMock,
      set: hoisted.redisSetMock,
      del: hoisted.redisDelMock,
    };
  }),
}));

const {
  getAgentMarketplaceReputationScores,
  setAgentMarketplaceReputationScores,
} = await import('@/lib/agent-marketplace/reputation-state-store');

describe('agent-marketplace reputation-state-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.state.clear();
    delete process.env.REDIS_URL;
    (globalThis as typeof globalThis & {
      __sentinai_agent_marketplace_reputation_redis?: unknown;
    }).__sentinai_agent_marketplace_reputation_redis = undefined;
  });

  it('returns empty object when REDIS_URL is missing', async () => {
    await expect(getAgentMarketplaceReputationScores()).resolves.toEqual({});
    expect(hoisted.redisCtorMock).not.toHaveBeenCalled();
  });

  it('silently no-ops writes when REDIS_URL is missing', async () => {
    await expect(
      setAgentMarketplaceReputationScores({
        '0x00000000000000000000000000000000000000a1': 92,
      })
    ).resolves.toBeUndefined();
    expect(hoisted.redisCtorMock).not.toHaveBeenCalled();
  });

  it('reads and writes reputation scores through Redis', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    await setAgentMarketplaceReputationScores({
      '0x00000000000000000000000000000000000000a1': 92,
      '0x00000000000000000000000000000000000000a2': 75,
    });

    await expect(getAgentMarketplaceReputationScores()).resolves.toEqual({
      '0x00000000000000000000000000000000000000a1': 92,
      '0x00000000000000000000000000000000000000a2': 75,
    });
    expect(hoisted.redisCtorMock).toHaveBeenCalledTimes(1);
  });
});
