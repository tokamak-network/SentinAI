import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  registerOpsDataMock: vi.fn(),
  clearRegistrationCacheMock: vi.fn().mockResolvedValue(undefined),
  saveRegistrationCacheMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/agent-marketplace/ops-registry', () => ({
  registerOpsData: hoisted.registerOpsDataMock,
}));

vi.mock('@/lib/agent-marketplace/registration-status', () => ({
  clearRegistrationCache: hoisted.clearRegistrationCacheMock,
  saveRegistrationCache: hoisted.saveRegistrationCacheMock,
}));

const { POST } = await import(
  '@/app/api/agent-marketplace/ops/register-ops/route'
);

describe('/api/agent-marketplace/ops/register-ops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MARKETPLACE_AGENT_URI_BASE = 'https://sentinai.example.com';
    process.env.MARKETPLACE_WALLET_KEY = '0x' + '1'.repeat(64);
    process.env.ERC8004_REGISTRY_ADDRESS = '0x64c8f8cB66657349190c7AF783f8E0254dCF1467';
  });

  it('registers ops-snapshot URI and returns success', async () => {
    hoisted.registerOpsDataMock.mockResolvedValue({
      ok: true,
      agentId: '7',
      opsUri: 'https://sentinai.example.com/api/agent-marketplace/ops-snapshot.json',
      txHash: '0xdeadbeef',
      registeredAt: '2026-03-17T00:00:00.000Z',
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.ok).toBe(true);
    expect(body.result.opsUri).toContain('ops-snapshot.json');
    expect(hoisted.registerOpsDataMock).toHaveBeenCalledWith({
      agentUriBase: 'https://sentinai.example.com',
      walletKey: '0x' + '1'.repeat(64),
      registryAddress: '0x64c8f8cB66657349190c7AF783f8E0254dCF1467',
    });
    expect(hoisted.clearRegistrationCacheMock).toHaveBeenCalled();
    expect(hoisted.saveRegistrationCacheMock).toHaveBeenCalledWith(
      expect.objectContaining({
        registered: true,
        agentUri: 'https://sentinai.example.com/api/agent-marketplace/ops-snapshot.json',
      }),
    );
  });

  it('returns 502 when registration fails', async () => {
    hoisted.registerOpsDataMock.mockResolvedValue({
      ok: false,
      error: 'Insufficient ETH',
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.result.ok).toBe(false);
    expect(body.result.error).toBe('Insufficient ETH');
    expect(hoisted.saveRegistrationCacheMock).not.toHaveBeenCalled();
  });
});
