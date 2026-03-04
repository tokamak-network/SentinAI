import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DomainAgent } from '@/core/agents/domain-agent';
import type { DomainAgentConfig, DomainAgentType } from '@/core/agents/domain-agent';
import type { ExperienceEntry } from '@/types/experience';

// ============================================================
// Mocks
// ============================================================

vi.mock('@/lib/experience-store', () => ({
  recordExperience: vi.fn().mockResolvedValue({
    id: 'test-id',
    instanceId: 'inst-1',
    protocolId: 'opstack',
    timestamp: '2026-03-03T00:00:00.000Z',
    category: 'scaling-action',
    trigger: { type: 'metric', metric: 'cpuUsage', value: 85 },
    action: 'scale_up',
    outcome: 'success',
    resolutionMs: 1000,
    metricsSnapshot: {},
  } satisfies ExperienceEntry),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================================
// Concrete test implementation
// ============================================================

class TestDomainAgent extends DomainAgent {
  readonly domain: DomainAgentType = 'scaling';
  public tickCallCount = 0;
  public shouldThrow = false;

  protected async tick(): Promise<void> {
    if (this.shouldThrow) throw new Error('Test tick error');
    this.tickCallCount += 1;
  }
}

// ============================================================
// Tests
// ============================================================

describe('DomainAgent', () => {
  let agent: TestDomainAgent;
  const config: DomainAgentConfig = {
    instanceId: 'inst-1',
    protocolId: 'opstack',
    intervalMs: 50, // fast for testing
  };

  beforeEach(() => {
    vi.useFakeTimers();
    agent = new TestDomainAgent(config);
  });

  afterEach(() => {
    agent.stop();
    vi.useRealTimers();
  });

  it('should not be running initially', () => {
    expect(agent.isRunning()).toBe(false);
    expect(agent.getTickCount()).toBe(0);
    expect(agent.getLastTickAt()).toBeNull();
  });

  it('should start and stop correctly', () => {
    agent.start();
    expect(agent.isRunning()).toBe(true);

    agent.stop();
    expect(agent.isRunning()).toBe(false);
  });

  it('should be idempotent on start', () => {
    agent.start();
    agent.start(); // should warn but not throw
    expect(agent.isRunning()).toBe(true);
  });

  it('should execute tick on interval', async () => {
    agent.start();

    // Advance time past one interval
    await vi.advanceTimersByTimeAsync(55);
    expect(agent.tickCallCount).toBe(1);
    expect(agent.getTickCount()).toBe(1);
    expect(agent.getLastTickAt()).not.toBeNull();

    // Advance again
    await vi.advanceTimersByTimeAsync(55);
    expect(agent.tickCallCount).toBe(2);
    expect(agent.getTickCount()).toBe(2);
  });

  it('should stop ticking after stop()', async () => {
    agent.start();
    await vi.advanceTimersByTimeAsync(55);
    expect(agent.tickCallCount).toBe(1);

    agent.stop();
    await vi.advanceTimersByTimeAsync(200);
    expect(agent.tickCallCount).toBe(1); // no more ticks
  });

  it('should survive tick errors without stopping', async () => {
    agent.shouldThrow = true;
    agent.start();

    await vi.advanceTimersByTimeAsync(55);
    expect(agent.isRunning()).toBe(true); // still running despite error
    expect(agent.getTickCount()).toBe(0); // tick wasn't counted due to error
  });

  it('should record domain experience with correct category', async () => {
    const { recordExperience } = await import('@/lib/experience-store');

    await agent['recordDomainExperience']({
      trigger: { type: 'metric', metric: 'cpuUsage', value: 85 },
      action: 'scale_up 2→4 vCPU',
      outcome: 'success',
      resolutionMs: 1000,
    });

    expect(recordExperience).toHaveBeenCalledWith({
      instanceId: 'inst-1',
      protocolId: 'opstack',
      category: 'scaling-action', // auto-mapped from 'scaling' domain
      trigger: { type: 'metric', metric: 'cpuUsage', value: 85 },
      action: 'scale_up 2→4 vCPU',
      outcome: 'success',
      resolutionMs: 1000,
      metricsSnapshot: {},
    });
  });

  it('should expose intervalMs via getter', () => {
    expect(agent.getIntervalMs()).toBe(50);
  });

  it('should use default intervalMs when not provided', () => {
    const defaultAgent = new TestDomainAgent({
      instanceId: 'inst-2',
      protocolId: 'opstack',
    });
    expect(defaultAgent.getIntervalMs()).toBe(30_000);
  });

  it('should expose instanceId and protocolId', () => {
    expect(agent.instanceId).toBe('inst-1');
    expect(agent.protocolId).toBe('opstack');
  });
});
