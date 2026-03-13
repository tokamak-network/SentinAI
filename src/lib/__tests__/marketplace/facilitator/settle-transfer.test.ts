import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const writeContract = vi.fn();
  const createWalletClient = vi.fn(() => ({
    writeContract,
  }));

  return {
    writeContract,
    createWalletClient,
  };
});

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createWalletClient: hoisted.createWalletClient,
    http: vi.fn(() => ({ transport: 'http' })),
  };
});

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: '0x2222222222222222222222222222222222222222',
  })),
}));

describe('settle transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits transferFrom for the expected merchant', async () => {
    hoisted.writeContract.mockResolvedValueOnce(
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    );

    const { settleTransfer } = await import('@/lib/marketplace/facilitator/settle-transfer');

    const result = await settleTransfer({
      profile: {
        chainId: 1,
        rpcUrl: 'https://mainnet.example',
        relayerPrivateKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
        tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
      },
      buyer: '0x1111111111111111111111111111111111111111',
      merchant: '0x4444444444444444444444444444444444444444',
      expectedMerchant: '0x4444444444444444444444444444444444444444',
      amount: 100000000000000000n,
    });

    expect(result).toEqual({
      txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      status: 'submitted',
    });
    expect(hoisted.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'transferFrom',
        args: [
          '0x1111111111111111111111111111111111111111',
          '0x4444444444444444444444444444444444444444',
          100000000000000000n,
        ],
      })
    );
  });

  it('blocks a wrong merchant before submission', async () => {
    const { settleTransfer } = await import('@/lib/marketplace/facilitator/settle-transfer');

    await expect(
      settleTransfer({
        profile: {
          chainId: 1,
          rpcUrl: 'https://mainnet.example',
          relayerPrivateKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
          tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        },
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x5555555555555555555555555555555555555555',
        expectedMerchant: '0x4444444444444444444444444444444444444444',
        amount: 100000000000000000n,
      })
    ).rejects.toThrow(/merchant/i);

    expect(hoisted.writeContract).not.toHaveBeenCalled();
  });

  it('surfaces on-chain revert failures', async () => {
    hoisted.writeContract.mockRejectedValueOnce(new Error('execution reverted'));

    const { settleTransfer } = await import('@/lib/marketplace/facilitator/settle-transfer');

    await expect(
      settleTransfer({
        profile: {
          chainId: 1,
          rpcUrl: 'https://mainnet.example',
          relayerPrivateKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
          tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        },
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        expectedMerchant: '0x4444444444444444444444444444444444444444',
        amount: 100000000000000000n,
      })
    ).rejects.toThrow(/reverted/i);
  });
});
