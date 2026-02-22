import { beforeEach, describe, expect, it, vi } from 'vitest';
import { switchL1RpcUrl, updateProxydBackendUrl } from '@/lib/l1-rpc-operator';

const hoisted = vi.hoisted(() => ({
  failoverMock: {
    executeFailover: vi.fn(),
    getActiveL1RpcUrl: vi.fn(),
    maskUrl: vi.fn((url: string) => `masked:${url}`),
    replaceProxydBackendUrl: vi.fn(),
    setActiveL1RpcUrl: vi.fn(),
  },
}));

vi.mock('@/lib/l1-rpc-failover', () => ({
  executeFailover: hoisted.failoverMock.executeFailover,
  getActiveL1RpcUrl: hoisted.failoverMock.getActiveL1RpcUrl,
  maskUrl: hoisted.failoverMock.maskUrl,
  replaceProxydBackendUrl: hoisted.failoverMock.replaceProxydBackendUrl,
  setActiveL1RpcUrl: hoisted.failoverMock.setActiveL1RpcUrl,
}));

describe('l1-rpc-operator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.failoverMock.getActiveL1RpcUrl.mockReturnValue('https://rpc-a.io');
    hoisted.failoverMock.executeFailover.mockResolvedValue({
      timestamp: new Date().toISOString(),
      fromUrl: 'masked:https://rpc-a.io',
      toUrl: 'masked:https://rpc-b.io',
      reason: 'manual',
      k8sUpdated: true,
      k8sComponents: [],
      simulated: false,
    });
    hoisted.failoverMock.setActiveL1RpcUrl.mockResolvedValue({
      timestamp: new Date().toISOString(),
      fromUrl: 'masked:https://rpc-a.io',
      toUrl: 'masked:https://rpc-c.io',
      reason: 'manual',
      k8sUpdated: true,
      k8sComponents: [],
      simulated: false,
    });
    hoisted.failoverMock.replaceProxydBackendUrl.mockResolvedValue({
      success: true,
      backendName: 'backend1',
      previousUrl: 'https://old.io',
      newUrl: 'https://new.io',
      event: {
        timestamp: new Date().toISOString(),
        backendName: 'backend1',
        oldUrl: 'masked:https://old.io',
        newUrl: 'masked:https://new.io',
        reason: 'manual',
        simulated: false,
      },
    });
  });

  it('should switch to next healthy endpoint when targetUrl not provided', async () => {
    const result = await switchL1RpcUrl({});
    expect(result.success).toBe(true);
    expect(hoisted.failoverMock.executeFailover).toHaveBeenCalled();
  });

  it('should switch to specific target endpoint when targetUrl is provided', async () => {
    hoisted.failoverMock.getActiveL1RpcUrl
      .mockReturnValueOnce('https://rpc-a.io')
      .mockReturnValueOnce('https://rpc-c.io');
    const result = await switchL1RpcUrl({ targetUrl: 'https://rpc-c.io' });
    expect(result.success).toBe(true);
    expect(hoisted.failoverMock.setActiveL1RpcUrl).toHaveBeenCalled();
  });

  it('should update proxyd backend url', async () => {
    const result = await updateProxydBackendUrl({
      backendName: 'backend1',
      newRpcUrl: 'https://new.io',
    });
    expect(result.success).toBe(true);
    expect(result.oldUrlRaw).toBe('https://old.io');
  });
});
