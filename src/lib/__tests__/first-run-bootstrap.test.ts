import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createInstance, listInstances } from '@/core/instance-registry';

const registerAgentMarketplaceIdentityMock = vi.fn(async () => ({
  ok: true,
  agentId: 'agent-marketplace-1',
}));

vi.mock('@/core/instance-registry', () => {
  return {
    listInstances: vi.fn(async () => []),
    createInstance: vi.fn(async () => ({ instanceId: 'inst-1' })),
    updateInstance: vi.fn(async () => undefined),
  };
});

vi.mock('@/core/collectors/connection-validator', () => {
  return {
    validateRpcConnection: vi.fn(async () => ({ valid: true, checks: [], totalLatencyMs: 1, clientVersion: 'Geth/x', chainId: 10 })),
  };
});

vi.mock('@/core/redis', () => {
  return {
    getCoreRedis: () => ({ set: vi.fn(async () => 'OK') }),
  };
});

vi.mock('@/lib/agent-marketplace/agent-registry', () => {
  return {
    registerAgentMarketplaceIdentity: (...args: unknown[]) => registerAgentMarketplaceIdentityMock(...args),
  };
});

import { firstRunBootstrap } from '@/lib/first-run-bootstrap';

describe('first-run-bootstrap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.L2_RPC_URL;
    delete process.env.SENTINAI_L2_RPC_URL;
    delete process.env.SENTINAI_L1_RPC_URL;
    delete process.env.L1_RPC_URL;
    delete process.env.MARKETPLACE_ENABLED;
    delete process.env.MARKETPLACE_AGENT_URI_BASE;
    delete process.env.MARKETPLACE_WALLET_KEY;
    delete process.env.ERC8004_REGISTRY_ADDRESS;
    registerAgentMarketplaceIdentityMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns error when no env vars present', async () => {
    const res = await firstRunBootstrap();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No connection environment variables/);
  });

  it('bootstraps using L2_RPC_URL', async () => {
    process.env.L2_RPC_URL = 'http://mock';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: 'ok' }), { status: 200 }))
    );

    const res = await firstRunBootstrap();
    expect(res.ok).toBe(true);
    expect(res.instanceId).toBe('inst-1');
    expect(res.protocolId).toBe('opstack-l2');
    expect(res.dashboardUrl).toBe('/v2');
  });

  it('uses SENTINAI_L2_RPC_URL alias', async () => {
    process.env.SENTINAI_L2_RPC_URL = 'http://mock-l2';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: 'ok' }), { status: 200 }))
    );

    const res = await firstRunBootstrap();
    expect(res.ok).toBe(true);
    expect(res.protocolId).toBe('opstack-l2');
  });

  it('reuses existing instance with normalized endpoint', async () => {
    process.env.L2_RPC_URL = 'HTTP://MOCK/';

    vi.mocked(listInstances).mockResolvedValueOnce([
      {
        instanceId: 'inst-existing',
        operatorId: 'default',
        protocolId: 'opstack-l2',
        displayName: 'Existing Node',
        connectionConfig: { rpcUrl: 'http://mock' },
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: 'ok' }), { status: 200 }))
    );

    const res = await firstRunBootstrap();
    expect(res.ok).toBe(true);
    expect(res.instanceId).toBe('inst-existing');
    expect(createInstance).not.toHaveBeenCalled();
  });

  it('skips marketplace registration when marketplace is disabled', async () => {
    process.env.L2_RPC_URL = 'http://mock';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: 'ok' }), { status: 200 }))
    );

    const res = await firstRunBootstrap();

    expect(res.ok).toBe(true);
    expect(registerAgentMarketplaceIdentityMock).not.toHaveBeenCalled();
  });

  it('returns a warning when marketplace is enabled but registration env is incomplete', async () => {
    process.env.L2_RPC_URL = 'http://mock';
    process.env.MARKETPLACE_ENABLED = 'true';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: 'ok' }), { status: 200 }))
    );

    const res = await firstRunBootstrap();

    expect(res.ok).toBe(true);
    expect(res.warnings?.some((warning) => warning.includes('marketplace registration skipped'))).toBe(true);
    expect(registerAgentMarketplaceIdentityMock).not.toHaveBeenCalled();
  });

  it('attempts marketplace registration when enabled and required env is present', async () => {
    process.env.L2_RPC_URL = 'http://mock';
    process.env.MARKETPLACE_ENABLED = 'true';
    process.env.MARKETPLACE_AGENT_URI_BASE = 'https://sentinai.example.com';
    process.env.MARKETPLACE_WALLET_KEY = 'wallet-key';
    process.env.ERC8004_REGISTRY_ADDRESS = '0xregistry';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: 'ok' }), { status: 200 }))
    );

    const res = await firstRunBootstrap();

    expect(res.ok).toBe(true);
    expect(registerAgentMarketplaceIdentityMock).toHaveBeenCalledTimes(1);
    expect(registerAgentMarketplaceIdentityMock).toHaveBeenCalledWith({
      agentUriBase: 'https://sentinai.example.com',
      walletKey: 'wallet-key',
      registryAddress: '0xregistry',
    });
  });

  it('keeps bootstrap successful and adds a warning when marketplace registration fails', async () => {
    process.env.L2_RPC_URL = 'http://mock';
    process.env.MARKETPLACE_ENABLED = 'true';
    process.env.MARKETPLACE_AGENT_URI_BASE = 'https://sentinai.example.com';
    process.env.MARKETPLACE_WALLET_KEY = 'wallet-key';
    process.env.ERC8004_REGISTRY_ADDRESS = '0xregistry';
    registerAgentMarketplaceIdentityMock.mockResolvedValueOnce({
      ok: false,
      error: 'registry unavailable',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: 'ok' }), { status: 200 }))
    );

    const res = await firstRunBootstrap();

    expect(res.ok).toBe(true);
    expect(res.warnings?.some((warning) => warning.includes('registry unavailable'))).toBe(true);
  });
});
