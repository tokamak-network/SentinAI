import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const readContract = vi.fn();
  const createPublicClient = vi.fn(() => ({
    readContract,
  }));

  return {
    readContract,
    createPublicClient,
  };
});

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: hoisted.createPublicClient,
    http: vi.fn(() => ({ transport: 'http' })),
  };
});

describe('facilitator fund checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts when buyer has sufficient balance and allowance', async () => {
    hoisted.readContract
      .mockResolvedValueOnce(200000000000000000n)
      .mockResolvedValueOnce(150000000000000000n);

    const { checkFunds } = await import('@/lib/marketplace/facilitator/check-funds');

    await expect(
      checkFunds({
        profile: {
          chainId: 1,
          rpcUrl: 'https://mainnet.example',
          tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        },
        buyer: '0x1111111111111111111111111111111111111111',
        facilitatorSpender: '0x2222222222222222222222222222222222222222',
        amount: 100000000000000000n,
      })
    ).resolves.toEqual({
      balance: 200000000000000000n,
      allowance: 150000000000000000n,
    });
  });

  it('rejects insufficient allowance', async () => {
    hoisted.readContract
      .mockResolvedValueOnce(200000000000000000n)
      .mockResolvedValueOnce(50000000000000000n);

    const { checkFunds } = await import('@/lib/marketplace/facilitator/check-funds');

    await expect(
      checkFunds({
        profile: {
          chainId: 1,
          rpcUrl: 'https://mainnet.example',
          tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        },
        buyer: '0x1111111111111111111111111111111111111111',
        facilitatorSpender: '0x2222222222222222222222222222222222222222',
        amount: 100000000000000000n,
      })
    ).rejects.toThrow(/allowance/i);
  });

  it('rejects insufficient balance', async () => {
    hoisted.readContract
      .mockResolvedValueOnce(50000000000000000n)
      .mockResolvedValueOnce(150000000000000000n);

    const { checkFunds } = await import('@/lib/marketplace/facilitator/check-funds');

    await expect(
      checkFunds({
        profile: {
          chainId: 1,
          rpcUrl: 'https://mainnet.example',
          tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        },
        buyer: '0x1111111111111111111111111111111111111111',
        facilitatorSpender: '0x2222222222222222222222222222222222222222',
        amount: 100000000000000000n,
      })
    ).rejects.toThrow(/balance/i);
  });
});
