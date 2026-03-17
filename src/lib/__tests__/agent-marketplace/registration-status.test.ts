import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  readContractMock: vi.fn(),
  createPublicClientMock: vi.fn(),
  httpMock: vi.fn(),
  privateKeyToAddressMock: vi.fn(),
}));

vi.mock('viem', () => ({
  createPublicClient: hoisted.createPublicClientMock,
  http: hoisted.httpMock,
  parseAbi: (abi: string[]) => abi,
}));

vi.mock('viem/accounts', () => ({
  privateKeyToAddress: hoisted.privateKeyToAddressMock,
}));

vi.mock('viem/chains', () => ({
  mainnet: { id: 1 },
  sepolia: { id: 11155111 },
  optimismSepolia: { id: 11155420 },
}));

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  })),
}));

const { getRegistrationStatus, saveRegistrationCache, clearRegistrationCache } = await import(
  '@/lib/agent-marketplace/registration-status'
);

describe('registration-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MARKETPLACE_WALLET_KEY;
    delete process.env.ERC8004_REGISTRY_ADDRESS;
    delete process.env.SENTINAI_L1_RPC_URL;
    delete process.env.REDIS_URL;
    (globalThis as Record<string, unknown>).__sentinaiRegistrationStatusCache = undefined;

    hoisted.privateKeyToAddressMock.mockReturnValue('0xWALLET');
    hoisted.readContractMock.mockResolvedValue(0n);
    hoisted.createPublicClientMock.mockReturnValue({
      readContract: hoisted.readContractMock,
    });
  });

  it('returns registered:false with envCheck false when env vars are missing', async () => {
    const status = await getRegistrationStatus();
    expect(status.registered).toBe(false);
    if (status.registered) throw new Error('expected unregistered');
    expect(status.envCheck.registryAddress).toBe(false);
    expect(status.envCheck.l1RpcUrl).toBe(false);
  });

  it('returns registered:false when latestAgentIdOf returns 0 (wallet from env)', async () => {
    process.env.MARKETPLACE_WALLET_KEY = '0x' + '1'.repeat(64);
    process.env.ERC8004_REGISTRY_ADDRESS = '0xREG';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example.com';

    hoisted.readContractMock.mockResolvedValue(0n);

    const status = await getRegistrationStatus();
    expect(status.registered).toBe(false);
    if (status.registered) throw new Error('expected unregistered');
    expect(status.envCheck.registryAddress).toBe(true);
    expect(status.envCheck.l1RpcUrl).toBe(true);
  });

  it('returns registered:false when latestAgentIdOf returns 0 (explicit wallet address)', async () => {
    process.env.ERC8004_REGISTRY_ADDRESS = '0xREG';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example.com';

    hoisted.readContractMock.mockResolvedValue(0n);

    const status = await getRegistrationStatus('0xExplicitWallet');
    expect(status.registered).toBe(false);
  });

  it('returns registered:true with agentId and agentUri when on-chain data exists', async () => {
    process.env.MARKETPLACE_WALLET_KEY = '0x' + '1'.repeat(64);
    process.env.ERC8004_REGISTRY_ADDRESS = '0xREG';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example.com';

    hoisted.readContractMock
      .mockResolvedValueOnce(42n)
      .mockResolvedValueOnce('https://my.sentinai.io/api/agent-marketplace/agent.json');

    const status = await getRegistrationStatus();
    expect(status.registered).toBe(true);
    if (!status.registered) throw new Error('expected registered');
    expect(status.agentId).toBe('42');
    expect(status.agentUri).toBe('https://my.sentinai.io/api/agent-marketplace/agent.json');
    expect(status.contractAddress).toBe('0xREG');
  });

  it('returns globalThis cache hit without RPC call when cache is valid', async () => {
    process.env.ERC8004_REGISTRY_ADDRESS = '0xREG';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example.com';

    (globalThis as Record<string, unknown>).__sentinaiRegistrationStatusCache = {
      value: {
        registered: true,
        agentId: '99',
        agentUri: 'https://cached.io/api/agent-marketplace/agent.json',
        txHash: '0xcached',
        registeredAt: '2024-01-01T00:00:00.000Z',
        contractAddress: '0xREG',
      },
      cachedAt: Date.now(),
    };

    const status = await getRegistrationStatus('0xSomeWallet');
    expect(status.registered).toBe(true);
    if (!status.registered) throw new Error('expected registered');
    expect(status.agentId).toBe('99');
    expect(hoisted.readContractMock).not.toHaveBeenCalled();
  });

  it('saveRegistrationCache stores result in globalThis', async () => {
    await saveRegistrationCache({
      registered: true,
      agentId: '5',
      agentUri: 'https://x.io/api/agent-marketplace/agent.json',
      txHash: '0xtx',
      registeredAt: '2024-03-13T14:22:00.000Z',
      contractAddress: '0xREG',
    });

    const cache = (globalThis as Record<string, unknown>).__sentinaiRegistrationStatusCache as
      { value: unknown; cachedAt: number } | undefined;
    expect(cache?.value).toBeDefined();
  });

  it('clearRegistrationCache clears globalThis cache', async () => {
    (globalThis as Record<string, unknown>).__sentinaiRegistrationStatusCache = {
      value: { registered: false, envCheck: { registryAddress: true, l1RpcUrl: true }, agentUri: null },
      cachedAt: Date.now(),
    };

    await clearRegistrationCache();

    expect((globalThis as Record<string, unknown>).__sentinaiRegistrationStatusCache).toBeUndefined();
  });
});
