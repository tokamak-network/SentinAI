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

const { registerAgentMarketplaceIdentity } = await import('@/lib/agent-marketplace/agent-registry');

describe('agent-marketplace agent-registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SENTINAI_L1_RPC_URL;
    delete process.env.L1_RPC_URL;
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

  it('submits register(agentURI) to the configured registry and returns tx hash when receipt succeeds', async () => {
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example.com';
    process.env.X402_NETWORK = 'eip155:11155111';
    hoisted.parseEventLogsMock.mockReturnValueOnce([
      {
        eventName: 'AgentRegistered',
        args: {
          agentId: 123n,
        },
      },
    ]);

    const result = await registerAgentMarketplaceIdentity({
      agentUriBase: 'https://sentinai.example.com',
      walletKey: '0x' + '1'.repeat(64),
      registryAddress: '0x00000000000000000000000000000000000000b1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected registry submission to succeed');
    }

    expect(hoisted.writeContractMock).toHaveBeenCalledTimes(1);
    expect(hoisted.writeContractMock.mock.calls[0][0]).toMatchObject({
      address: '0x00000000000000000000000000000000000000b1',
      functionName: 'register',
      args: ['https://sentinai.example.com/api/agent-marketplace/agent.json'],
    });
    expect(result.txHash).toBe('0xtxhash');
    expect(result.agentId).toBe('123');
  });

  it('fails when no L1 RPC is configured', async () => {
    const result = await registerAgentMarketplaceIdentity({
      agentUriBase: 'https://sentinai.example.com',
      walletKey: '0x' + '1'.repeat(64),
      registryAddress: '0x00000000000000000000000000000000000000b1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected missing RPC configuration to fail');
    }

    expect(result.error).toContain('L1 RPC');
    expect(hoisted.writeContractMock).not.toHaveBeenCalled();
  });

  it('fails when the transaction receipt is not successful', async () => {
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example.com';
    hoisted.waitForTransactionReceiptMock.mockResolvedValueOnce({
      status: 'reverted',
      logs: [],
    });

    const result = await registerAgentMarketplaceIdentity({
      agentUriBase: 'https://sentinai.example.com',
      walletKey: '0x' + '1'.repeat(64),
      registryAddress: '0x00000000000000000000000000000000000000b1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected reverted receipt to fail');
    }

    expect(result.error).toContain('receipt status');
  });

  it('falls back to an alternate registry event signature when AgentRegistered is absent', async () => {
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example.com';
    hoisted.parseEventLogsMock
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          eventName: 'Register',
          args: {
            agent: '0x00000000000000000000000000000000000000a1',
            agentURI: 'https://sentinai.example.com/api/agent-marketplace/agent.json',
          },
        },
      ]);

    const result = await registerAgentMarketplaceIdentity({
      agentUriBase: 'https://sentinai.example.com',
      walletKey: '0x' + '1'.repeat(64),
      registryAddress: '0x00000000000000000000000000000000000000b1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected alternate registry event parsing to succeed');
    }

    expect(result.agentId).toBe('0x00000000000000000000000000000000000000a1');
    expect(hoisted.parseEventLogsMock).toHaveBeenCalledTimes(2);
  });
});
