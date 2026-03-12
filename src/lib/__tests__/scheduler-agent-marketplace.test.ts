import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const tasks: Array<{ expression: string; fn: () => Promise<void> | void }> = [];
  return {
    tasks,
    scheduleMock: vi.fn((expression: string, fn: () => Promise<void> | void) => {
      tasks.push({ expression, fn });
      return {
        stop: vi.fn(),
      };
    }),
    publishDailyBatchMock: vi.fn(async () => ({ ok: true, batchHash: 'QmBatchCid', txHash: '0xtxhash' })),
  };
});

vi.mock('node-cron', () => ({
  default: {
    schedule: hoisted.scheduleMock,
  },
}));

vi.mock('@/lib/daily-accumulator', () => ({
  initializeAccumulator: vi.fn(async () => undefined),
  takeSnapshot: vi.fn(async () => null),
  getAccumulatedData: vi.fn(async () => null),
}));

vi.mock('@/lib/daily-report-generator', () => ({
  generateDailyReport: vi.fn(async () => ({ success: true, reportPath: '/tmp/report.md' })),
}));

vi.mock('@/lib/daily-report-mailer', () => ({
  deliverDailyReport: vi.fn(async () => ({ success: true, method: 'noop' })),
}));

vi.mock('@/lib/scheduled-scaler', () => ({
  applyScheduledScaling: vi.fn(async () => ({ executed: false, message: 'skipped' })),
  buildScheduleProfile: vi.fn(async () => undefined),
}));

vi.mock('@/lib/agent-memory', () => ({
  cleanupExpiredAgentMemory: vi.fn(async () => 0),
}));

vi.mock('@/core/agent-orchestrator', () => ({
  getAgentOrchestrator: () => ({
    startInstance: vi.fn(),
    stopAll: vi.fn(),
  }),
}));

vi.mock('@/lib/agent-marketplace/reputation-job', () => ({
  publishDailyAgentMarketplaceReputationBatch: hoisted.publishDailyBatchMock,
}));

const scheduler = await import('@/lib/scheduler');

describe('scheduler agent-marketplace integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.tasks.length = 0;
    delete process.env.MARKETPLACE_REPUTATION_ENABLED;
    delete process.env.MARKETPLACE_REPUTATION_SCHEDULE;
    scheduler.stopScheduler();
  });

  afterEach(() => {
    scheduler.stopScheduler();
  });

  it('registers a daily reputation batch cron when marketplace reputation is enabled', async () => {
    process.env.MARKETPLACE_REPUTATION_ENABLED = 'true';
    process.env.MARKETPLACE_REPUTATION_SCHEDULE = '10 0 * * *';

    await scheduler.initializeScheduler();

    expect(hoisted.scheduleMock).toHaveBeenCalled();
    expect(hoisted.tasks.some((task) => task.expression === '10 0 * * *')).toBe(true);
  });

  it('runs the scheduled reputation batch without overriding persisted previous scores', async () => {
    process.env.MARKETPLACE_REPUTATION_ENABLED = 'true';
    process.env.MARKETPLACE_REPUTATION_SCHEDULE = '10 0 * * *';

    await scheduler.initializeScheduler();

    const reputationTask = hoisted.tasks.find((task) => task.expression === '10 0 * * *');
    expect(reputationTask).toBeDefined();
    await reputationTask?.fn();

    expect(hoisted.publishDailyBatchMock).toHaveBeenCalledTimes(1);
    expect(hoisted.publishDailyBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromIso: expect.any(String),
        toIso: expect.any(String),
        batchTimestamp: expect.any(Number),
      })
    );
    expect(hoisted.publishDailyBatchMock.mock.calls[0]?.[0]).not.toHaveProperty('previousScores');
  });

  it('does not register a reputation cron when marketplace reputation is disabled', async () => {
    await scheduler.initializeScheduler();

    expect(hoisted.tasks.some((task) => task.expression === '10 0 * * *')).toBe(false);
    expect(hoisted.publishDailyBatchMock).not.toHaveBeenCalled();
  });
});
