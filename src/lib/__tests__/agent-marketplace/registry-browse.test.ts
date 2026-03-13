import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  createPublicClientMock: vi.fn(),
  httpMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');

  return {
    ...actual,
    createPublicClient: hoisted.createPublicClientMock,
    http: hoisted.httpMock,
  };
});

describe('getAgentMarketplaceRegistryBrowseData', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-13T00:00:00.000Z'));
    vi.clearAllMocks();
    delete process.env.ERC8004_REGISTRY_ADDRESS;
    delete process.env.SENTINAI_L1_RPC_URL;
    delete process.env.L1_RPC_URL;
    delete process.env.X402_NETWORK;
    vi.stubGlobal('fetch', hoisted.fetchMock);
  });

  afterEach(async () => {
    const { resetAgentMarketplaceRegistryBrowseCache } = await import('@/lib/agent-marketplace/registry-browse');
    resetAgentMarketplaceRegistryBrowseCache();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns an empty state when registry configuration is missing', async () => {
    const { getAgentMarketplaceRegistryBrowseData } = await import('@/lib/agent-marketplace/registry-browse');

    await expect(getAgentMarketplaceRegistryBrowseData()).resolves.toMatchObject({
      ok: false,
      rows: [],
      status: 'Registry browse is not configured',
    });
  });

  it('loads latest registrations per operator and enriches manifests', async () => {
    process.env.ERC8004_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000b1';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example';
    hoisted.httpMock.mockReturnValue({ transport: 'http' });

    hoisted.createPublicClientMock.mockReturnValue({
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            agentId: 1n,
            agent: '0x00000000000000000000000000000000000000a1',
            agentURI: 'https://old.example/api/agent-marketplace/agent.json',
          },
        },
        {
          args: {
            agentId: 2n,
            agent: '0x00000000000000000000000000000000000000a1',
            agentURI: 'https://new.example/api/agent-marketplace/agent.json',
          },
        },
        {
          args: {
            agentId: 3n,
            agent: '0x00000000000000000000000000000000000000a2',
            agentURI: 'https://other.example/api/agent-marketplace/agent.json',
          },
        },
      ]),
    });

    hoisted.fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'Other Instance',
          version: '2026-03-12',
          endpoint: '/api/agent-marketplace',
          capabilities: ['batch_submission_status'],
          payment: { network: 'eip155:11155111' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'New Instance',
          version: '2026-03-13',
          endpoint: '/api/agent-marketplace',
          capabilities: ['sequencer_health', 'incident_summary'],
          payment: { network: 'eip155:11155111' },
        }),
      });

    const { getAgentMarketplaceRegistryBrowseData } = await import('@/lib/agent-marketplace/registry-browse');
    const result = await getAgentMarketplaceRegistryBrowseData();

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.totalRows).toBe(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(5);
    expect(result.totalPages).toBe(1);
    expect(result.hasPreviousPage).toBe(false);
    expect(result.hasNextPage).toBe(false);
    expect(result.rows[0]).toMatchObject({
      agentId: '3',
      agent: '0x00000000000000000000000000000000000000a2',
      manifestStatus: 'ok',
      manifest: {
        name: 'Other Instance',
      },
    });
    expect(result.rows[1]).toMatchObject({
      agentId: '2',
      agent: '0x00000000000000000000000000000000000000a1',
      agentUri: 'https://new.example/api/agent-marketplace/agent.json',
      manifestStatus: 'ok',
      manifest: {
        capabilities: ['sequencer_health', 'incident_summary'],
      },
    });
    expect(hoisted.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps rows when manifest fetch fails', async () => {
    process.env.ERC8004_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000b1';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example';
    hoisted.httpMock.mockReturnValue({ transport: 'http' });

    hoisted.createPublicClientMock.mockReturnValue({
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            agentId: 4n,
            agent: '0x00000000000000000000000000000000000000a4',
            agentURI: 'https://broken.example/api/agent-marketplace/agent.json',
          },
        },
      ]),
    });

    hoisted.fetchMock.mockRejectedValue(new Error('network failed'));

    const { getAgentMarketplaceRegistryBrowseData } = await import('@/lib/agent-marketplace/registry-browse');
    const result = await getAgentMarketplaceRegistryBrowseData();

    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([
      expect.objectContaining({
        agentId: '4',
        manifestStatus: 'unavailable',
        manifest: null,
      }),
    ]);
  });

  it('returns the requested page slice with page metadata', async () => {
    process.env.ERC8004_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000b1';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example';
    hoisted.httpMock.mockReturnValue({ transport: 'http' });

    hoisted.createPublicClientMock.mockReturnValue({
      getLogs: vi.fn().mockResolvedValue(
        Array.from({ length: 6 }, (_, index) => ({
          args: {
            agentId: BigInt(index + 1),
            agent: `0x00000000000000000000000000000000000000a${index + 1}`,
            agentURI: `https://instance-${index + 1}.example/api/agent-marketplace/agent.json`,
          },
        }))
      ),
    });

    hoisted.fetchMock.mockImplementation(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => ({
        name: `Instance ${String(input).match(/instance-(\d+)/)?.[1] ?? '0'}`,
        version: '2026-03-13',
        endpoint: '/api/agent-marketplace',
        capabilities: ['sequencer_health'],
        payment: { network: 'eip155:11155111' },
      }),
    }));

    const { getAgentMarketplaceRegistryBrowseData } = await import('@/lib/agent-marketplace/registry-browse');
    const result = await getAgentMarketplaceRegistryBrowseData({ page: 2 });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.agentId).toBe('1');
    expect(result.totalRows).toBe(6);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(5);
    expect(result.totalPages).toBe(2);
    expect(result.hasPreviousPage).toBe(true);
    expect(result.hasNextPage).toBe(false);
  });

  it('falls back to page 1 for invalid page input', async () => {
    process.env.ERC8004_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000b1';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example';
    hoisted.httpMock.mockReturnValue({ transport: 'http' });

    hoisted.createPublicClientMock.mockReturnValue({
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            agentId: 1n,
            agent: '0x00000000000000000000000000000000000000a1',
            agentURI: 'https://fallback.example/api/agent-marketplace/agent.json',
          },
        },
      ]),
    });

    hoisted.fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        name: 'Fallback Instance',
        version: '2026-03-13',
        endpoint: '/api/agent-marketplace',
        capabilities: ['sequencer_health'],
        payment: { network: 'eip155:11155111' },
      }),
    });

    const { getAgentMarketplaceRegistryBrowseData } = await import('@/lib/agent-marketplace/registry-browse');
    const result = await getAgentMarketplaceRegistryBrowseData({ page: Number.NaN });

    expect(result.page).toBe(1);
    expect(result.rows).toHaveLength(1);
  });

  it('reuses a successful browse result within the cache ttl', async () => {
    process.env.ERC8004_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000b1';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example';
    hoisted.httpMock.mockReturnValue({ transport: 'http' });

    const getLogsMock = vi.fn().mockResolvedValue([
      {
        args: {
          agentId: 9n,
          agent: '0x00000000000000000000000000000000000000a9',
          agentURI: 'https://cache.example/api/agent-marketplace/agent.json',
        },
      },
    ]);

    hoisted.createPublicClientMock.mockReturnValue({
      getLogs: getLogsMock,
    });

    hoisted.fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        name: 'Cache Instance',
        version: '2026-03-13',
        endpoint: '/api/agent-marketplace',
        capabilities: ['sequencer_health'],
        payment: { network: 'eip155:11155111' },
      }),
    });

    const { getAgentMarketplaceRegistryBrowseData } = await import('@/lib/agent-marketplace/registry-browse');

    const first = await getAgentMarketplaceRegistryBrowseData();
    const second = await getAgentMarketplaceRegistryBrowseData();

    expect(first).toEqual(second);
    expect(getLogsMock).toHaveBeenCalledTimes(1);
    expect(hoisted.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes the cache after the ttl expires', async () => {
    process.env.ERC8004_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000b1';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example';
    hoisted.httpMock.mockReturnValue({ transport: 'http' });

    const getLogsMock = vi.fn().mockResolvedValue([
      {
        args: {
          agentId: 10n,
          agent: '0x0000000000000000000000000000000000000010',
          agentURI: 'https://refresh.example/api/agent-marketplace/agent.json',
        },
      },
    ]);

    hoisted.createPublicClientMock.mockReturnValue({
      getLogs: getLogsMock,
    });

    hoisted.fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        name: 'Refresh Instance',
        version: '2026-03-13',
        endpoint: '/api/agent-marketplace',
        capabilities: ['incident_summary'],
        payment: { network: 'eip155:11155111' },
      }),
    });

    const { getAgentMarketplaceRegistryBrowseData } = await import('@/lib/agent-marketplace/registry-browse');

    await getAgentMarketplaceRegistryBrowseData();
    vi.advanceTimersByTime(30_001);
    await getAgentMarketplaceRegistryBrowseData();

    expect(getLogsMock).toHaveBeenCalledTimes(2);
    expect(hoisted.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed top-level browse attempt', async () => {
    process.env.ERC8004_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000b1';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example';
    hoisted.httpMock.mockReturnValue({ transport: 'http' });

    const getLogsMock = vi.fn()
      .mockRejectedValueOnce(new Error('rpc unavailable'))
      .mockResolvedValueOnce([]);

    hoisted.createPublicClientMock.mockReturnValue({
      getLogs: getLogsMock,
    });

    const { getAgentMarketplaceRegistryBrowseData } = await import('@/lib/agent-marketplace/registry-browse');

    const first = await getAgentMarketplaceRegistryBrowseData();
    const second = await getAgentMarketplaceRegistryBrowseData();

    expect(first).toMatchObject({
      ok: false,
      status: 'rpc unavailable',
    });
    expect(second).toMatchObject({
      ok: true,
      rows: [],
    });
    expect(getLogsMock).toHaveBeenCalledTimes(2);
  });
});
