import { beforeEach, describe, expect, it, vi } from 'vitest';

const initializeSchedulerMock = vi.fn(async () => undefined);
const firstRunBootstrapMock = vi.fn(async () => ({ ok: true, instanceId: 'inst-1', protocolId: 'opstack-l2' }));

vi.mock('@/lib/scheduler', () => ({
  initializeScheduler: initializeSchedulerMock,
}));

vi.mock('@/lib/first-run-bootstrap', () => ({
  firstRunBootstrap: firstRunBootstrapMock,
}));

describe('instrumentation register', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.SENTINAI_AUTO_BOOTSTRAP;
    process.env.NEXT_RUNTIME = 'nodejs';
    delete (globalThis as typeof globalThis & { __sentinai_first_run_bootstrap_started__?: boolean }).__sentinai_first_run_bootstrap_started__;
  });

  it('runs scheduler and first-run bootstrap once in nodejs runtime', async () => {
    const { register } = await import('@/instrumentation');

    await register();
    await register();

    expect(initializeSchedulerMock).toHaveBeenCalledTimes(2);
    expect(firstRunBootstrapMock).toHaveBeenCalledTimes(1);
  });

  it('skips first-run bootstrap when disabled by env', async () => {
    process.env.SENTINAI_AUTO_BOOTSTRAP = 'false';
    const { register } = await import('@/instrumentation');

    await register();

    expect(initializeSchedulerMock).toHaveBeenCalledTimes(1);
    expect(firstRunBootstrapMock).not.toHaveBeenCalled();
  });
});
