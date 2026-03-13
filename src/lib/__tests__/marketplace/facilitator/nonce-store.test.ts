import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const redis = {
    set: vi.fn(),
  };

  return {
    redis,
    getCoreRedisMock: vi.fn(() => redis),
  };
});

vi.mock('@/core/redis', () => ({
  getCoreRedis: hoisted.getCoreRedisMock,
}));

describe('facilitator nonce store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a fresh nonce and rejects a reused nonce', async () => {
    hoisted.redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    const { consumeNonce } = await import('@/lib/marketplace/facilitator/nonce-store');

    await expect(
      consumeNonce({
        redisPrefix: 'sentinai:test',
        chainId: 1,
        buyer: '0x1111111111111111111111111111111111111111',
        nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        validBefore: 1_741_680_300n,
      })
    ).resolves.toBeUndefined();

    await expect(
      consumeNonce({
        redisPrefix: 'sentinai:test',
        chainId: 1,
        buyer: '0x1111111111111111111111111111111111111111',
        nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        validBefore: 1_741_680_300n,
      })
    ).rejects.toThrow(/nonce/i);
  });

  it('isolates mainnet and sepolia nonce namespaces', async () => {
    hoisted.redis.set.mockResolvedValue('OK');

    const { consumeNonce } = await import('@/lib/marketplace/facilitator/nonce-store');

    await consumeNonce({
      redisPrefix: 'sentinai:test',
      chainId: 1,
      buyer: '0x1111111111111111111111111111111111111111',
      nonce: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      validBefore: 1_741_680_300n,
    });

    await consumeNonce({
      redisPrefix: 'sentinai:test',
      chainId: 11155111,
      buyer: '0x1111111111111111111111111111111111111111',
      nonce: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      validBefore: 1_741_680_300n,
    });

    expect(hoisted.redis.set).toHaveBeenNthCalledWith(
      1,
      'sentinai:test:facilitator:nonce:1:0x1111111111111111111111111111111111111111:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      expect.any(String),
      'EXAT',
      1741680300,
      'NX'
    );
    expect(hoisted.redis.set).toHaveBeenNthCalledWith(
      2,
      'sentinai:test:facilitator:nonce:11155111:0x1111111111111111111111111111111111111111:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      expect.any(String),
      'EXAT',
      1741680300,
      'NX'
    );
  });
});
