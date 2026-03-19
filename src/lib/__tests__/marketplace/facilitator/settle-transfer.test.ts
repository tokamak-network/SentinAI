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

const FACILITATOR_ADDRESS = '0x3333333333333333333333333333333333333333';
const TON_ASSET = '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5';
const BUYER = '0x1111111111111111111111111111111111111111';
const MERCHANT = '0x4444444444444444444444444444444444444444';
const AMOUNT = 100000000000000000n;
const RESOURCE = '/api/marketplace/data';
const NONCE = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as `0x${string}`;
const VALID_AFTER = 0n;
const VALID_BEFORE = 9999999999n;
const SIGNATURE = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefde' as `0x${string}`;

const BASE_PROFILE = {
  chainId: 1 as const,
  rpcUrl: 'https://mainnet.example',
  relayerPrivateKey: '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`,
  tonAssetAddress: TON_ASSET as `0x${string}`,
  facilitatorAddress: FACILITATOR_ADDRESS as `0x${string}`,
};

describe('settle transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls settle() on the facilitator contract for the expected merchant', async () => {
    hoisted.writeContract.mockResolvedValueOnce(
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    );

    const { settleTransfer } = await import('@/lib/marketplace/facilitator/settle-transfer');

    const result = await settleTransfer({
      profile: BASE_PROFILE,
      buyer: BUYER,
      merchant: MERCHANT,
      expectedMerchant: MERCHANT,
      amount: AMOUNT,
      resource: RESOURCE,
      nonce: NONCE,
      validAfter: VALID_AFTER,
      validBefore: VALID_BEFORE,
      signature: SIGNATURE,
    });

    expect(result).toEqual({
      txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      status: 'submitted',
    });
    expect(hoisted.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FACILITATOR_ADDRESS,
        functionName: 'settle',
        args: [
          BUYER,
          MERCHANT,
          TON_ASSET,
          AMOUNT,
          RESOURCE,
          NONCE,
          VALID_AFTER,
          VALID_BEFORE,
          SIGNATURE,
        ],
      })
    );
  });

  it('blocks a wrong merchant before submission', async () => {
    const { settleTransfer } = await import('@/lib/marketplace/facilitator/settle-transfer');

    await expect(
      settleTransfer({
        profile: BASE_PROFILE,
        buyer: BUYER,
        merchant: '0x5555555555555555555555555555555555555555',
        expectedMerchant: MERCHANT,
        amount: AMOUNT,
        resource: RESOURCE,
        nonce: NONCE,
        validAfter: VALID_AFTER,
        validBefore: VALID_BEFORE,
        signature: SIGNATURE,
      })
    ).rejects.toThrow(/merchant/i);

    expect(hoisted.writeContract).not.toHaveBeenCalled();
  });

  it('surfaces on-chain revert failures', async () => {
    hoisted.writeContract.mockRejectedValueOnce(new Error('execution reverted'));

    const { settleTransfer } = await import('@/lib/marketplace/facilitator/settle-transfer');

    await expect(
      settleTransfer({
        profile: BASE_PROFILE,
        buyer: BUYER,
        merchant: MERCHANT,
        expectedMerchant: MERCHANT,
        amount: AMOUNT,
        resource: RESOURCE,
        nonce: NONCE,
        validAfter: VALID_AFTER,
        validBefore: VALID_BEFORE,
        signature: SIGNATURE,
      })
    ).rejects.toThrow(/reverted/i);
  });
});
