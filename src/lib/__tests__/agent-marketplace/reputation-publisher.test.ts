import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  uploadBatchMock: vi.fn(),
  submitRootMock: vi.fn(),
}));

vi.mock('@/lib/agent-marketplace/ipfs-publisher', () => ({
  uploadAgentMarketplaceBatchToIpfs: hoisted.uploadBatchMock,
}));

vi.mock('@/lib/agent-marketplace/reputation-submit', () => ({
  submitAgentMarketplaceReputationRoot: hoisted.submitRootMock,
}));

const { publishAgentMarketplaceReputationBatch } = await import('@/lib/agent-marketplace/reputation-publisher');

describe('agent-marketplace reputation-publisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.uploadBatchMock.mockResolvedValue({
      ok: true,
      batchHash: 'QmBatchCid',
    });
    hoisted.submitRootMock.mockResolvedValue({
      ok: true,
      txHash: '0xtxhash',
    });
  });

  it('uploads the batch payload and then submits the root on-chain', async () => {
    const result = await publishAgentMarketplaceReputationBatch({
      walletKey: '0x' + '1'.repeat(64),
      registryAddress: '0x00000000000000000000000000000000000000c1',
      batch: {
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
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected publisher to succeed');
    }
    expect(hoisted.uploadBatchMock).toHaveBeenCalledTimes(1);
    expect(hoisted.submitRootMock).toHaveBeenCalledTimes(1);
    expect(result.batchHash).toBe('QmBatchCid');
    expect(result.txHash).toBe('0xtxhash');
  });
});
