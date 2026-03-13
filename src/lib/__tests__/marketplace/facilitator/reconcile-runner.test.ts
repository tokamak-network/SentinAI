import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const schedule = vi.fn((_cron, callback) => ({
    start: vi.fn(),
    stop: vi.fn(),
    __callback: callback,
  }));
  const loadFacilitatorConfig = vi.fn();
  const reconcileSubmittedSettlements = vi.fn();

  return {
    schedule,
    loadFacilitatorConfig,
    reconcileSubmittedSettlements,
  };
});

vi.mock('node-cron', () => ({
  default: {
    schedule: hoisted.schedule,
  },
}));
vi.mock('@/lib/marketplace/facilitator/config', () => ({
  loadFacilitatorConfig: hoisted.loadFacilitatorConfig,
}));
vi.mock('@/lib/marketplace/facilitator/reconcile-settlements', () => ({
  reconcileSubmittedSettlements: hoisted.reconcileSubmittedSettlements,
}));

describe('facilitator reconcile runner', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    hoisted.loadFacilitatorConfig.mockReturnValue({
      redisPrefix: 'sentinai:test',
      reconciler: { enabled: true, cron: '*/15 * * * * *' },
      profiles: {
        mainnet: {
          enabled: true,
          chainId: 1,
          rpcUrl: 'https://mainnet.example',
          tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        },
        sepolia: {
          enabled: false,
          chainId: 11155111,
          rpcUrl: 'https://sepolia.example',
          tonAssetAddress: '0xa30fe40285b8f5c0457dbc3b7c8a280373c40044',
        },
      },
    });

    const mod = await import('@/lib/marketplace/facilitator/reconcile-runner');
    mod.resetFacilitatorReconcilerForTests();
  });

  it('registers the scheduler only once', async () => {
    const { ensureFacilitatorReconcilerStarted } = await import('@/lib/marketplace/facilitator/reconcile-runner');

    await ensureFacilitatorReconcilerStarted();
    await ensureFacilitatorReconcilerStarted();

    expect(hoisted.schedule).toHaveBeenCalledTimes(1);
    expect(hoisted.schedule).toHaveBeenCalledWith('*/15 * * * * *', expect.any(Function));
  });

  it('does not start when the reconciler is disabled', async () => {
    hoisted.loadFacilitatorConfig.mockReturnValueOnce({
      redisPrefix: 'sentinai:test',
      reconciler: { enabled: false, cron: '*/15 * * * * *' },
      profiles: { mainnet: { enabled: true, chainId: 1, rpcUrl: 'https://mainnet.example', tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5' } },
    });

    const mod = await import('@/lib/marketplace/facilitator/reconcile-runner');
    mod.resetFacilitatorReconcilerForTests();
    await mod.ensureFacilitatorReconcilerStarted();

    expect(hoisted.schedule).not.toHaveBeenCalled();
  });

  it('runs reconciliation for enabled profiles on each cron tick', async () => {
    const { ensureFacilitatorReconcilerStarted } = await import('@/lib/marketplace/facilitator/reconcile-runner');

    await ensureFacilitatorReconcilerStarted();

    const callback = hoisted.schedule.mock.calls[0]?.[1] as (() => Promise<void>) | undefined;
    expect(callback).toBeTypeOf('function');

    await callback?.();

    expect(hoisted.reconcileSubmittedSettlements).toHaveBeenCalledWith({
      redisPrefix: 'sentinai:test',
      profile: {
        enabled: true,
        chainId: 1,
        rpcUrl: 'https://mainnet.example',
        tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
      },
    });
    expect(hoisted.reconcileSubmittedSettlements).toHaveBeenCalledTimes(1);
  });
});
