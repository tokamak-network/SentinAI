import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  summarizeSlaMock: vi.fn(),
  buildBatchMock: vi.fn(),
  publishBatchMock: vi.fn(),
  setScoresMock: vi.fn(),
  getScoresMock: vi.fn(() => ({
    '0x00000000000000000000000000000000000000a1': 90,
  })),
}));

vi.mock('@/lib/agent-marketplace/sla-tracker', () => ({
  summarizeAgentMarketplaceSla: hoisted.summarizeSlaMock,
}));

vi.mock('@/lib/agent-marketplace/reputation-batch', () => ({
  buildAgentMarketplaceReputationBatch: hoisted.buildBatchMock,
}));

vi.mock('@/lib/agent-marketplace/reputation-publisher', () => ({
  publishAgentMarketplaceReputationBatch: hoisted.publishBatchMock,
}));

vi.mock('@/lib/agent-marketplace/reputation-state-store', () => ({
  setAgentMarketplaceReputationScores: hoisted.setScoresMock,
  getAgentMarketplaceReputationScores: hoisted.getScoresMock,
}));

const { publishDailyAgentMarketplaceReputationBatch } = await import('@/lib/agent-marketplace/reputation-job');

describe('agent-marketplace reputation-job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MARKETPLACE_WALLET_KEY;
    delete process.env.MARKETPLACE_REPUTATION_REGISTRY_ADDRESS;
    delete process.env.REDIS_URL;

    hoisted.getScoresMock.mockResolvedValue({
      '0x00000000000000000000000000000000000000a1': 90,
    });
    hoisted.setScoresMock.mockResolvedValue(undefined);
    hoisted.summarizeSlaMock.mockResolvedValue({
      fromIso: '2026-03-12T00:00:00.000Z',
      toIso: '2026-03-12T23:59:59.999Z',
      agents: [
        {
          agentId: '0x00000000000000000000000000000000000000a1',
          totalRequests: 10,
          successRate: 100,
          averageLatencyMs: 500,
          scoreDelta: 2,
          newScore: 92,
        },
      ],
    });
    hoisted.buildBatchMock.mockReturnValue({
      algorithm: 'keccak256',
      batchTimestamp: 1710201600,
      root: '0x' + 'a'.repeat(64),
      leaves: [
        {
          agentId: '0x00000000000000000000000000000000000000a1',
          score: 92,
          leaf: '0x' + '1'.repeat(64),
        },
      ],
      proofs: {
        '0x00000000000000000000000000000000000000a1': [],
      },
    });
    hoisted.publishBatchMock.mockResolvedValue({
      ok: true,
      batchHash: 'QmBatchCid',
      txHash: '0xtxhash',
    });
  });

  it('builds and publishes a daily reputation batch from SLA summaries', async () => {
    process.env.MARKETPLACE_WALLET_KEY = '0x' + '1'.repeat(64);
    process.env.MARKETPLACE_REPUTATION_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000c1';
    process.env.REDIS_URL = 'redis://localhost:6379';

    const result = await publishDailyAgentMarketplaceReputationBatch({
      fromIso: '2026-03-12T00:00:00.000Z',
      toIso: '2026-03-12T23:59:59.999Z',
      previousScores: {
        '0x00000000000000000000000000000000000000a1': 90,
      },
      batchTimestamp: 1710201600,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected daily batch publish to succeed');
    }
    expect(hoisted.summarizeSlaMock).toHaveBeenCalledTimes(1);
    expect(hoisted.summarizeSlaMock).toHaveBeenCalledWith({
      fromIso: '2026-03-12T00:00:00.000Z',
      toIso: '2026-03-12T23:59:59.999Z',
      previousScores: {
        '0x00000000000000000000000000000000000000a1': 90,
      },
    });
    expect(hoisted.buildBatchMock).toHaveBeenCalledTimes(1);
    expect(hoisted.publishBatchMock).toHaveBeenCalledTimes(1);
    expect(hoisted.setScoresMock).toHaveBeenCalledWith({
      '0x00000000000000000000000000000000000000a1': 92,
    });
  });

  it('fails early when required publishing env is missing', async () => {
    const result = await publishDailyAgentMarketplaceReputationBatch({
      fromIso: '2026-03-12T00:00:00.000Z',
      toIso: '2026-03-12T23:59:59.999Z',
      previousScores: {},
      batchTimestamp: 1710201600,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected missing env to fail');
    }
    expect(result.error).toContain('MARKETPLACE_WALLET_KEY');
    expect(hoisted.publishBatchMock).not.toHaveBeenCalled();
  });

  it('uses persisted reputation scores when previousScores input is omitted', async () => {
    process.env.MARKETPLACE_WALLET_KEY = '0x' + '1'.repeat(64);
    process.env.MARKETPLACE_REPUTATION_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000c1';
    process.env.REDIS_URL = 'redis://localhost:6379';

    await publishDailyAgentMarketplaceReputationBatch({
      fromIso: '2026-03-12T00:00:00.000Z',
      toIso: '2026-03-12T23:59:59.999Z',
      batchTimestamp: 1710201600,
    });

    expect(hoisted.getScoresMock).toHaveBeenCalledTimes(1);
    expect(hoisted.summarizeSlaMock).toHaveBeenCalledWith({
      fromIso: '2026-03-12T00:00:00.000Z',
      toIso: '2026-03-12T23:59:59.999Z',
      previousScores: {
        '0x00000000000000000000000000000000000000a1': 90,
      },
    });
  });

  it('fails closed when Redis-backed previous score lookup fails', async () => {
    process.env.MARKETPLACE_WALLET_KEY = '0x' + '1'.repeat(64);
    process.env.MARKETPLACE_REPUTATION_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000c1';
    process.env.REDIS_URL = 'redis://localhost:6379';

    hoisted.getScoresMock.mockRejectedValueOnce(new Error('Redis unavailable'));

    const result = await publishDailyAgentMarketplaceReputationBatch({
      fromIso: '2026-03-12T00:00:00.000Z',
      toIso: '2026-03-12T23:59:59.999Z',
      batchTimestamp: 1710201600,
    });

    expect(result).toEqual({
      ok: false,
      error: 'Failed to load agent marketplace reputation scores from Redis: Redis unavailable',
    });
    expect(hoisted.summarizeSlaMock).not.toHaveBeenCalled();
    expect(hoisted.publishBatchMock).not.toHaveBeenCalled();
  });

  it('fails closed when Redis-backed score persistence fails after publish', async () => {
    process.env.MARKETPLACE_WALLET_KEY = '0x' + '1'.repeat(64);
    process.env.MARKETPLACE_REPUTATION_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000c1';
    process.env.REDIS_URL = 'redis://localhost:6379';

    hoisted.setScoresMock.mockRejectedValueOnce(new Error('Redis write failed'));

    const result = await publishDailyAgentMarketplaceReputationBatch({
      fromIso: '2026-03-12T00:00:00.000Z',
      toIso: '2026-03-12T23:59:59.999Z',
      previousScores: {
        '0x00000000000000000000000000000000000000a1': 90,
      },
      batchTimestamp: 1710201600,
    });

    expect(result).toEqual({
      ok: false,
      error: 'Failed to persist agent marketplace reputation scores to Redis: Redis write failed',
    });
  });
});
