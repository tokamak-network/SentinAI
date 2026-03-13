import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const getTransaction = vi.fn();
  const getTransactionReceipt = vi.fn();
  const decodeFunctionData = vi.fn();
  const decodeEventLog = vi.fn();
  const createPublicClient = vi.fn(() => ({
    getTransaction,
    getTransactionReceipt,
  }));

  return {
    getTransaction,
    getTransactionReceipt,
    decodeFunctionData,
    decodeEventLog,
    createPublicClient,
  };
});

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: hoisted.createPublicClient,
    decodeFunctionData: hoisted.decodeFunctionData,
    decodeEventLog: hoisted.decodeEventLog,
    http: vi.fn(() => ({ transport: 'http' })),
  };
});

describe('verify settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns settled when tx target, calldata, receipt, and Transfer log all match', async () => {
    hoisted.getTransaction.mockResolvedValueOnce({
      to: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
      input: '0xdeadbeef',
      blockNumber: 12345678n,
    });
    hoisted.getTransactionReceipt.mockResolvedValueOnce({
      status: 'success',
      logs: [{ address: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5', topics: [], data: '0x' }],
      blockNumber: 12345678n,
    });
    hoisted.decodeFunctionData.mockReturnValueOnce({
      functionName: 'transferFrom',
      args: [
        '0x1111111111111111111111111111111111111111',
        '0x4444444444444444444444444444444444444444',
        100000000000000000n,
      ],
    });
    hoisted.decodeEventLog.mockReturnValueOnce({
      eventName: 'Transfer',
      args: {
        from: '0x1111111111111111111111111111111111111111',
        to: '0x4444444444444444444444444444444444444444',
        value: 100000000000000000n,
      },
    });

    const { verifySettlement } = await import('@/lib/marketplace/facilitator/verify-settlement');

    const result = await verifySettlement({
      profile: {
        rpcUrl: 'https://mainnet.example',
        tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
      },
      txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      expected: {
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        amount: 100000000000000000n,
      },
    });

    expect(result).toEqual({
      status: 'settled',
      blockNumber: 12345678,
      transferVerified: true,
    });
  });

  it('returns submitted when the tx is not mined yet', async () => {
    hoisted.getTransaction.mockResolvedValueOnce({
      to: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
      input: '0xdeadbeef',
      blockNumber: null,
    });
    hoisted.getTransactionReceipt.mockResolvedValueOnce(null);

    const { verifySettlement } = await import('@/lib/marketplace/facilitator/verify-settlement');

    const result = await verifySettlement({
      profile: {
        rpcUrl: 'https://mainnet.example',
        tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
      },
      txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      expected: {
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        amount: 100000000000000000n,
      },
    });

    expect(result).toEqual({
      status: 'submitted',
      blockNumber: null,
      transferVerified: false,
    });
  });

  it('returns failed on contract or decoded transfer mismatch', async () => {
    hoisted.getTransaction.mockResolvedValueOnce({
      to: '0x9999999999999999999999999999999999999999',
      input: '0xdeadbeef',
      blockNumber: 12345678n,
    });

    const { verifySettlement } = await import('@/lib/marketplace/facilitator/verify-settlement');

    const result = await verifySettlement({
      profile: {
        rpcUrl: 'https://mainnet.example',
        tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
      },
      txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      expected: {
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        amount: 100000000000000000n,
      },
    });

    expect(result.status).toBe('failed');
    expect(result.failureReason).toMatch(/contract/i);
  });
});
