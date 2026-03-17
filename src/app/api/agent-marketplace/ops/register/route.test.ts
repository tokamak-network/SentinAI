import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  registerIdentityMock: vi.fn(),
  clearRegistrationCacheMock: vi.fn().mockResolvedValue(undefined),
  saveRegistrationCacheMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/agent-marketplace/agent-registry', () => ({
  registerAgentMarketplaceIdentity: hoisted.registerIdentityMock,
}));

vi.mock('@/lib/agent-marketplace/registration-status', () => ({
  clearRegistrationCache: hoisted.clearRegistrationCacheMock,
  saveRegistrationCache: hoisted.saveRegistrationCacheMock,
}));

const { POST } = await import('@/app/api/agent-marketplace/ops/register/route');

describe('/api/agent-marketplace/ops/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MARKETPLACE_AGENT_URI_BASE = 'https://sentinai.example.com';
    process.env.MARKETPLACE_WALLET_KEY = '0x' + '1'.repeat(64);
    process.env.ERC8004_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000b1';
  });

  it('submits registry registration and returns the result', async () => {
    hoisted.registerIdentityMock.mockResolvedValue({
      ok: true,
      agentId: '12',
      txHash: '0xtxhash',
      registeredAt: '2026-03-17T00:00:00.000Z',
    });

    const response = await POST(
      new Request('http://localhost/api/agent-marketplace/ops/register', {
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.ok).toBe(true);
    expect(body.result.txHash).toBe('0xtxhash');
    expect(hoisted.registerIdentityMock).toHaveBeenCalledWith({
      agentUriBase: 'https://sentinai.example.com',
      walletKey: '0x' + '1'.repeat(64),
      registryAddress: '0x00000000000000000000000000000000000000b1',
    });
    expect(hoisted.clearRegistrationCacheMock).toHaveBeenCalled();
    expect(hoisted.saveRegistrationCacheMock).toHaveBeenCalledWith(
      expect.objectContaining({ registered: true })
    );
  });

  it('returns a 502 response when registration fails', async () => {
    hoisted.registerIdentityMock.mockResolvedValue({
      ok: false,
      error: 'RPC unavailable',
    });

    const response = await POST(
      new Request('http://localhost/api/agent-marketplace/ops/register', {
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.result).toEqual({
      ok: false,
      error: 'RPC unavailable',
    });
  });
});
