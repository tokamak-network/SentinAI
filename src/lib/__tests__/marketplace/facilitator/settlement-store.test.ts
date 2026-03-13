import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const redis = {
    get: vi.fn(),
    set: vi.fn(),
    sadd: vi.fn(),
    smembers: vi.fn(),
    srem: vi.fn(),
  };

  return {
    redis,
    getCoreRedisMock: vi.fn(() => redis),
  };
});

vi.mock('@/core/redis', () => ({
  getCoreRedis: hoisted.getCoreRedisMock,
}));

describe('facilitator settlement store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.redis.set.mockResolvedValue('OK');
    hoisted.redis.sadd.mockResolvedValue(1);
    hoisted.redis.srem.mockResolvedValue(1);
  });

  it('creates and looks up a settlement record', async () => {
    const { createSettlement, getSettlement } = await import('@/lib/marketplace/facilitator/settlement-store');

    const record = {
      settlementId: 'stl_123',
      chainId: 1,
      network: 'eip155:1' as const,
      merchantId: 'sequencer-health',
      asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5' as const,
      buyer: '0x1111111111111111111111111111111111111111' as const,
      merchant: '0x4444444444444444444444444444444444444444' as const,
      amount: '100000000000000000',
      resource: '/api/marketplace/sequencer-health',
      nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const,
      txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const,
      status: 'submitted' as const,
      txStatus: 'submitted' as const,
      receiptSignature: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' as const,
      confirmedBlock: null,
      transferVerified: false,
      failureReason: null,
      createdAt: '2026-03-12T00:00:00.000Z',
      updatedAt: '2026-03-12T00:00:00.000Z',
    };

    await createSettlement('sentinai:test', record);
    hoisted.redis.get.mockResolvedValueOnce(JSON.stringify(record));

    const loaded = await getSettlement('sentinai:test', 1, 'stl_123');

    expect(hoisted.redis.set).toHaveBeenCalledWith(
      'sentinai:test:facilitator:settlement:1:stl_123',
      JSON.stringify(record)
    );
    expect(hoisted.redis.sadd).toHaveBeenCalledWith('sentinai:test:facilitator:pending:1', 'stl_123');
    expect(loaded).toEqual(record);
  });

  it('lists pending settlements and updates final status', async () => {
    const { listPendingSettlements, markSettlementStatus } = await import('@/lib/marketplace/facilitator/settlement-store');

    hoisted.redis.smembers.mockResolvedValueOnce(['stl_123']);
    hoisted.redis.get.mockResolvedValueOnce(
      JSON.stringify({
        settlementId: 'stl_123',
        chainId: 1,
        network: 'eip155:1',
        merchantId: 'sequencer-health',
        asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        amount: '100000000000000000',
        resource: '/api/marketplace/sequencer-health',
        nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        status: 'submitted',
        txStatus: 'submitted',
        receiptSignature: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        confirmedBlock: null,
        transferVerified: false,
        failureReason: null,
        createdAt: '2026-03-12T00:00:00.000Z',
        updatedAt: '2026-03-12T00:00:00.000Z',
      })
    );
    hoisted.redis.get.mockResolvedValueOnce(
      JSON.stringify({
        settlementId: 'stl_123',
        chainId: 1,
        network: 'eip155:1',
        merchantId: 'sequencer-health',
        asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        amount: '100000000000000000',
        resource: '/api/marketplace/sequencer-health',
        nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        status: 'submitted',
        txStatus: 'submitted',
        receiptSignature: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        confirmedBlock: null,
        transferVerified: false,
        failureReason: null,
        createdAt: '2026-03-12T00:00:00.000Z',
        updatedAt: '2026-03-12T00:00:00.000Z',
      })
    );

    const pending = await listPendingSettlements('sentinai:test', 1);
    expect(pending).toHaveLength(1);

    await markSettlementStatus('sentinai:test', 1, 'stl_123', {
      status: 'settled',
      txStatus: 'settled',
      transferVerified: true,
      confirmedBlock: 12345678,
      failureReason: null,
    });

    expect(hoisted.redis.srem).toHaveBeenCalledWith('sentinai:test:facilitator:pending:1', 'stl_123');
    expect(hoisted.redis.set).toHaveBeenCalledWith(
      'sentinai:test:facilitator:settlement:1:stl_123',
      expect.stringContaining('"status":"settled"')
    );
  });
});
