import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const listPendingSettlements = vi.fn();
  const markSettlementStatus = vi.fn();
  const verifySettlement = vi.fn();

  return {
    listPendingSettlements,
    markSettlementStatus,
    verifySettlement,
  };
});

vi.mock('@/lib/marketplace/facilitator/settlement-store', () => ({
  listPendingSettlements: hoisted.listPendingSettlements,
  markSettlementStatus: hoisted.markSettlementStatus,
}));
vi.mock('@/lib/marketplace/facilitator/verify-settlement', () => ({
  verifySettlement: hoisted.verifySettlement,
}));

describe('reconcile submitted settlements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks submitted settlements as settled after successful verification', async () => {
    hoisted.listPendingSettlements.mockResolvedValueOnce([
      {
        settlementId: 'stl_123',
        chainId: 1,
        txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        amount: '100000000000000000',
        status: 'submitted',
      },
    ]);
    hoisted.verifySettlement.mockResolvedValueOnce({
      status: 'settled',
      blockNumber: 12345678,
      transferVerified: true,
    });
    hoisted.markSettlementStatus.mockResolvedValue(undefined);

    const { reconcileSubmittedSettlements } = await import('@/lib/marketplace/facilitator/reconcile-settlements');

    const result = await reconcileSubmittedSettlements({
      redisPrefix: 'sentinai:test',
      profile: {
        chainId: 1,
        rpcUrl: 'https://mainnet.example',
        tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
      },
    });

    expect(result).toEqual({ processed: 1, settled: 1, failed: 0, skipped: 0 });
    expect(hoisted.markSettlementStatus).toHaveBeenCalledWith('sentinai:test', 1, 'stl_123', {
      status: 'settled',
      txStatus: 'settled',
      transferVerified: true,
      confirmedBlock: 12345678,
      failureReason: null,
    });
  });

  it('marks mismatched or reverted settlements as failed', async () => {
    hoisted.listPendingSettlements.mockResolvedValueOnce([
      {
        settlementId: 'stl_123',
        chainId: 1,
        txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        amount: '100000000000000000',
        status: 'submitted',
      },
    ]);
    hoisted.verifySettlement.mockResolvedValueOnce({
      status: 'failed',
      blockNumber: 12345678,
      transferVerified: false,
      failureReason: 'Transfer log mismatch',
    });

    const { reconcileSubmittedSettlements } = await import('@/lib/marketplace/facilitator/reconcile-settlements');

    const result = await reconcileSubmittedSettlements({
      redisPrefix: 'sentinai:test',
      profile: {
        chainId: 1,
        rpcUrl: 'https://mainnet.example',
        tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
      },
    });

    expect(result).toEqual({ processed: 1, settled: 0, failed: 1, skipped: 0 });
    expect(hoisted.markSettlementStatus).toHaveBeenCalledWith('sentinai:test', 1, 'stl_123', {
      status: 'failed',
      txStatus: 'failed',
      transferVerified: false,
      confirmedBlock: 12345678,
      failureReason: 'Transfer log mismatch',
    });
  });

  it('skips already final settlements if they appear in the pending scan', async () => {
    hoisted.listPendingSettlements.mockResolvedValueOnce([
      {
        settlementId: 'stl_123',
        chainId: 1,
        txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        amount: '100000000000000000',
        status: 'settled',
      },
    ]);

    const { reconcileSubmittedSettlements } = await import('@/lib/marketplace/facilitator/reconcile-settlements');

    const result = await reconcileSubmittedSettlements({
      redisPrefix: 'sentinai:test',
      profile: {
        chainId: 1,
        rpcUrl: 'https://mainnet.example',
        tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
      },
    });

    expect(result).toEqual({ processed: 1, settled: 0, failed: 0, skipped: 1 });
    expect(hoisted.verifySettlement).not.toHaveBeenCalled();
  });
});
