import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyOperationOutcome } from '@/lib/operation-verifier';

const hoisted = vi.hoisted(() => ({
  scalerMock: {
    getCurrentVcpu: vi.fn(),
  },
  actionMock: {
    executeAction: vi.fn(),
  },
  l1Mock: {
    getActiveL1RpcUrl: vi.fn(),
    healthCheckEndpoint: vi.fn(),
    maskUrl: vi.fn((url: string) => url),
  },
}));

vi.mock('@/lib/k8s-scaler', () => ({
  getCurrentVcpu: hoisted.scalerMock.getCurrentVcpu,
}));

vi.mock('@/lib/action-executor', () => ({
  executeAction: hoisted.actionMock.executeAction,
}));

vi.mock('@/lib/l1-rpc-failover', () => ({
  getActiveL1RpcUrl: hoisted.l1Mock.getActiveL1RpcUrl,
  healthCheckEndpoint: hoisted.l1Mock.healthCheckEndpoint,
  maskUrl: hoisted.l1Mock.maskUrl,
}));

describe('operation-verifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.scalerMock.getCurrentVcpu.mockResolvedValue(4);
    hoisted.actionMock.executeAction.mockResolvedValue({
      status: 'success',
      output: 'Health check: op-geth is Ready',
    });
    hoisted.l1Mock.getActiveL1RpcUrl.mockReturnValue('https://rpc-a.io');
    hoisted.l1Mock.healthCheckEndpoint.mockResolvedValue(true);
  });

  it('should pass scale verification when vcpu matches', async () => {
    const result = await verifyOperationOutcome({
      actionType: 'scale_component',
      dryRun: false,
      expected: { targetVcpu: 4 },
      observed: {},
    });

    expect(result.passed).toBe(true);
    expect(result.observed).toContain('4');
  });

  it('should fail scale verification when vcpu mismatches', async () => {
    hoisted.scalerMock.getCurrentVcpu.mockResolvedValue(2);

    const result = await verifyOperationOutcome({
      actionType: 'scale_component',
      dryRun: false,
      expected: { targetVcpu: 4 },
      observed: {},
    });

    expect(result.passed).toBe(false);
  });

  it('should run restart health verification', async () => {
    const result = await verifyOperationOutcome({
      actionType: 'restart_component',
      dryRun: false,
      expected: { target: 'op-geth' },
      observed: {},
    });

    expect(result.passed).toBe(true);
    expect(hoisted.actionMock.executeAction).toHaveBeenCalled();
  });

  it('should verify switch_l1_rpc with active endpoint health', async () => {
    hoisted.l1Mock.getActiveL1RpcUrl.mockReturnValue('https://rpc-b.io');

    const result = await verifyOperationOutcome({
      actionType: 'switch_l1_rpc',
      dryRun: false,
      expected: { targetUrl: 'https://rpc-b.io' },
      observed: {},
    });

    expect(result.passed).toBe(true);
  });
});
