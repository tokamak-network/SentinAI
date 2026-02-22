import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRollbackPlan, runRollbackPlan } from '@/lib/rollback-runner';

const hoisted = vi.hoisted(() => ({
  scalerMock: {
    scaleOpGeth: vi.fn(),
  },
  l1OperatorMock: {
    switchL1RpcUrl: vi.fn(),
    updateProxydBackendUrl: vi.fn(),
  },
  verifierMock: {
    verifyOperationOutcome: vi.fn(),
  },
}));

vi.mock('@/lib/k8s-scaler', () => ({
  scaleOpGeth: hoisted.scalerMock.scaleOpGeth,
}));

vi.mock('@/lib/l1-rpc-operator', () => ({
  switchL1RpcUrl: hoisted.l1OperatorMock.switchL1RpcUrl,
  updateProxydBackendUrl: hoisted.l1OperatorMock.updateProxydBackendUrl,
}));

vi.mock('@/lib/operation-verifier', () => ({
  verifyOperationOutcome: hoisted.verifierMock.verifyOperationOutcome,
}));

describe('rollback-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.scalerMock.scaleOpGeth.mockResolvedValue({
      success: true,
      previousVcpu: 4,
      currentVcpu: 2,
      previousMemoryGiB: 8,
      currentMemoryGiB: 4,
      timestamp: new Date().toISOString(),
      message: 'rolled back',
    });
    hoisted.l1OperatorMock.switchL1RpcUrl.mockResolvedValue({
      success: true,
      fromUrl: 'a',
      fromUrlRaw: 'https://a.io',
      toUrl: 'b',
      toUrlRaw: 'https://b.io',
      message: 'switched',
      k8sUpdated: true,
    });
    hoisted.l1OperatorMock.updateProxydBackendUrl.mockResolvedValue({
      success: true,
      backendName: 'backend1',
      oldUrl: 'old',
      oldUrlRaw: 'https://old.io',
      newUrl: 'new',
      newUrlRaw: 'https://new.io',
      message: 'updated',
    });
    hoisted.verifierMock.verifyOperationOutcome.mockResolvedValue({
      expected: 'ok',
      observed: 'ok',
      passed: true,
      details: 'verified',
      verifiedAt: new Date().toISOString(),
    });
  });

  it('should build scale rollback plan from previous vcpu', () => {
    const plan = buildRollbackPlan({
      actionType: 'scale_component',
      execution: { previousVcpu: 2, currentVcpu: 4 },
    });

    expect(plan.available).toBe(true);
    expect(plan.params?.targetVcpu).toBe(2);
  });

  it('should execute scale rollback plan', async () => {
    const result = await runRollbackPlan(
      {
        available: true,
        actionType: 'scale_component',
        params: { targetVcpu: 2 },
      },
      false
    );

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(true);
    expect(hoisted.scalerMock.scaleOpGeth).toHaveBeenCalled();
  });

  it('should simulate rollback on dry run', async () => {
    const result = await runRollbackPlan(
      {
        available: true,
        actionType: 'switch_l1_rpc',
        params: { targetUrl: 'https://rpc-a.io' },
      },
      true
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('DRY RUN');
  });
});
