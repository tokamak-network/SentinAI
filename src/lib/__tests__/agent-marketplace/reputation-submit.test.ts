import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  createPublicClientMock: vi.fn(),
  createWalletClientMock: vi.fn(),
  httpMock: vi.fn(),
  parseEventLogsMock: vi.fn(),
  privateKeyToAccountMock: vi.fn(),
  waitForTransactionReceiptMock: vi.fn(),
  writeContractMock: vi.fn(),
}));

vi.mock('viem', () => ({
  createPublicClient: hoisted.createPublicClientMock,
  createWalletClient: hoisted.createWalletClientMock,
  http: hoisted.httpMock,
  parseAbi: (abi: TemplateStringsArray | string[]) => abi,
  parseEventLogs: hoisted.parseEventLogsMock,
}));

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: hoisted.privateKeyToAccountMock,
}));

vi.mock('viem/chains', () => ({
  mainnet: { id: 1, name: 'Ethereum Mainnet' },
  sepolia: { id: 11155111, name: 'Sepolia' },
}));

const { submitAgentMarketplaceReputationRoot } = await import('@/lib/agent-marketplace/reputation-submit');

describe('agent-marketplace reputation-submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SENTINAI_L1_RPC_URL;
    delete process.env.X402_NETWORK;

    hoisted.privateKeyToAccountMock.mockReturnValue({
      address: '0x00000000000000000000000000000000000000a1',
    });
    hoisted.writeContractMock.mockResolvedValue('0xtxhash');
    hoisted.waitForTransactionReceiptMock.mockResolvedValue({
      status: 'success',
      logs: [],
    });
    hoisted.parseEventLogsMock.mockReturnValue([]);
    hoisted.createWalletClientMock.mockReturnValue({
      writeContract: hoisted.writeContractMock,
    });
    hoisted.createPublicClientMock.mockReturnValue({
      waitForTransactionReceipt: hoisted.waitForTransactionReceiptMock,
    });
  });

  it('submits the merkle root, scores, and batch hash to the reputation registry', async () => {
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example.com';
    hoisted.parseEventLogsMock.mockReturnValueOnce([
      {
        eventName: 'MerkleRootSubmitted',
        args: {
          batchHash: 'QmBatchCid',
          merkleRoot: '0x' + 'a'.repeat(64),
        },
      },
    ]);

    const result = await submitAgentMarketplaceReputationRoot({
      walletKey: '0x' + '1'.repeat(64),
      registryAddress: '0x00000000000000000000000000000000000000c1',
      batchHash: 'QmBatchCid',
      root: '0x' + 'a'.repeat(64),
      agents: [
        { agentId: '0x00000000000000000000000000000000000000a1', score: 92 },
        { agentId: '0x00000000000000000000000000000000000000a2', score: 75 },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected submit to succeed');
    }
    expect(hoisted.writeContractMock).toHaveBeenCalledTimes(1);
    expect(hoisted.writeContractMock.mock.calls[0][0]).toMatchObject({
      functionName: 'submitMerkleRoot',
      args: [
        [
          '0x00000000000000000000000000000000000000a1',
          '0x00000000000000000000000000000000000000a2',
        ],
        [92, 75],
        '0x' + 'a'.repeat(64),
        'QmBatchCid',
      ],
    });
    expect(result.batchHash).toBe('QmBatchCid');
  });

  it('falls back to an alternate reputation event signature when MerkleRootSubmitted is absent', async () => {
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example.com';
    hoisted.parseEventLogsMock
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          eventName: 'RootSubmitted',
          args: {
            root: '0x' + 'b'.repeat(64),
            batchHash: 'QmAltBatchCid',
          },
        },
      ]);

    const result = await submitAgentMarketplaceReputationRoot({
      walletKey: '0x' + '1'.repeat(64),
      registryAddress: '0x00000000000000000000000000000000000000c1',
      batchHash: 'QmBatchCid',
      root: '0x' + 'a'.repeat(64),
      agents: [
        { agentId: '0x00000000000000000000000000000000000000a1', score: 92 },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected alternate reputation event parsing to succeed');
    }

    expect(result.batchHash).toBe('QmAltBatchCid');
    expect(result.merkleRoot).toBe('0x' + 'b'.repeat(64));
    expect(hoisted.parseEventLogsMock).toHaveBeenCalledTimes(2);
  });
});
