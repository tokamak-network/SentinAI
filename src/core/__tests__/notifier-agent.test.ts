import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotifierAgent } from '@/core/agents/notifier-agent';
import type { AgentEvent, AgentEventHandler } from '@/core/agent-event-bus';

// ============================================================
// Mocks
// ============================================================

const handlers: Record<string, AgentEventHandler[]> = {};

vi.mock('@/core/agent-event-bus', () => ({
  getAgentEventBus: () => ({
    emit: vi.fn(),
    on: (type: string, handler: AgentEventHandler) => {
      handlers[type] = handlers[type] || [];
      handlers[type].push(handler);
    },
    off: (type: string, handler: AgentEventHandler) => {
      handlers[type] = (handlers[type] || []).filter(h => h !== handler);
    },
  }),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('@/lib/redis-store', () => ({
  getStore: () => ({
    getAlertConfig: vi.fn().mockResolvedValue({
      webhookUrl: 'https://hooks.slack.com/test',
      thresholds: { notifyOn: ['high', 'critical'], cooldownMinutes: 10 },
      enabled: true,
    }),
  }),
}));

const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
vi.stubGlobal('fetch', mockFetch);

// ============================================================
// Helpers
// ============================================================

function emit(type: string, payload: Record<string, unknown>, instanceId = 'inst-1'): void {
  const event: AgentEvent = {
    type: type as AgentEvent['type'],
    instanceId,
    payload,
    timestamp: '2026-03-06T00:00:00.000Z',
    correlationId: 'corr-1',
  };
  for (const handler of handlers[type] || []) {
    handler(event);
  }
}

/** Parse the fetch body and return { text, blocks } */
function parseFetchBody(callIndex = 0): { text: string; blocks: Array<Record<string, unknown>> } {
  const [, options] = mockFetch.mock.calls[callIndex];
  return JSON.parse(options.body as string);
}

/** Stringify all blocks for easy searching */
function blocksText(callIndex = 0): string {
  return JSON.stringify(parseFetchBody(callIndex).blocks);
}

// ============================================================
// Tests
// ============================================================

describe('NotifierAgent', () => {
  let agent: NotifierAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(handlers).forEach(k => delete handlers[k]);
    agent = new NotifierAgent({ instanceId: 'inst-1' });
  });

  afterEach(() => {
    agent.stop();
  });

  it('should subscribe to 4 event types on start', () => {
    agent.start();
    expect(handlers['cost-insight']?.length).toBe(1);
    expect(handlers['scaling-recommendation']?.length).toBe(1);
    expect(handlers['verification-complete']?.length).toBe(1);
    expect(handlers['remediation-complete']?.length).toBe(1);
  });

  it('should unsubscribe on stop', () => {
    agent.start();
    agent.stop();
    expect(handlers['cost-insight']?.length).toBe(0);
    expect(handlers['scaling-recommendation']?.length).toBe(0);
    expect(handlers['verification-complete']?.length).toBe(0);
    expect(handlers['remediation-complete']?.length).toBe(0);
  });

  it('should send Block Kit notification on cost-insight', async () => {
    agent.start();
    emit('cost-insight', {
      insights: [{ type: 'overprovision', detail: 'Consider downscaling', savingsUsd: 10.5 }],
      totalPotentialSavingsUsd: 10.5,
    });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/test');

    const body = parseFetchBody();
    expect(body.text).toContain('Cost Insight');
    expect(body.blocks).toBeDefined();
    expect(body.blocks.length).toBeGreaterThanOrEqual(3);
    expect(blocksText()).toContain('$10.50');
    expect(blocksText()).toContain('Consider downscaling');
    // Instance field should NOT be present
    expect(blocksText()).not.toContain('Instance');
    expect(agent.getNotificationCount()).toBe(1);
  });

  it('should send Block Kit notification on scaling-recommendation', async () => {
    agent.start();
    emit('scaling-recommendation', {
      source: 'cost-insight',
      type: 'schedule',
      profile: {
        id: 'sched-1',
        avgDailyVcpu: 1.5,
        estimatedMonthlySavings: 10.29,
        coveragePct: 85,
      },
      execution: {
        executed: true,
        previousVcpu: 2,
        targetVcpu: 1,
        message: 'Scheduled scaling applied: 2 → 1 vCPU',
      },
      recommendation: {
        title: 'Time-Based Scheduling',
        savings: 10.29,
        confidence: 0.85,
      },
    });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const body = parseFetchBody();
    expect(body.text).toContain('Applied');
    expect(blocksText()).toContain('$10.29');
    expect(blocksText()).toContain('85%');
    expect(blocksText()).toContain('2 → 1 vCPU');
  });

  it('should NOT send scaling-recommendation from non-cost sources', async () => {
    agent.start();
    emit('scaling-recommendation', {
      source: 'manual',
      type: 'schedule',
    });

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should send Block Kit notification on verification failure', async () => {
    agent.start();
    emit('verification-complete', {
      operationRecord: {
        executed: true,
        passed: false,
        detail: 'observed 1 vCPU, expected 4 vCPU',
        expectedVcpu: 4,
        observedVcpu: 1,
      },
    });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const body = parseFetchBody();
    expect(body.text).toContain('Verification Failed');
    expect(blocksText()).toContain('4 vCPU');
    expect(blocksText()).toContain('1 vCPU');
  });

  it('should NOT notify on verification success', async () => {
    agent.start();
    emit('verification-complete', {
      operationRecord: {
        executed: true,
        passed: true,
        detail: 'ok',
        expectedVcpu: 4,
        observedVcpu: 4,
      },
    });

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should send Block Kit notification on remediation-complete', async () => {
    agent.start();
    emit('remediation-complete', {
      trigger: 'security-alert',
      results: [
        { action: 'eoa-refill', success: true, detail: 'batcher refilled: 0.05 → 0.55 ETH' },
      ],
      successCount: 1,
      failureCount: 0,
    });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const body = parseFetchBody();
    expect(body.text).toContain('Remediation Complete');
    expect(blocksText()).toContain('eoa-refill');
    expect(blocksText()).toContain('security-alert');
  });

  it('should suppress duplicate notifications within cooldown window', async () => {
    agent.start();

    // First cost-insight → should send
    emit('cost-insight', {
      insights: [{ type: 'test', detail: 'first', savingsUsd: 1 }],
      totalPotentialSavingsUsd: 1,
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    // Second cost-insight immediately → should be suppressed (1h cooldown)
    emit('cost-insight', {
      insights: [{ type: 'test', detail: 'second', savingsUsd: 2 }],
      totalPotentialSavingsUsd: 2,
    });
    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledTimes(1); // Still only 1 call

    // Different event type → should send (independent cooldown)
    emit('remediation-complete', {
      trigger: 'test',
      results: [{ action: 'test', success: true, detail: 'ok' }],
      successCount: 1,
      failureCount: 0,
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it('should ignore events from other instances', async () => {
    agent.start();
    emit('cost-insight', {
      insights: [{ type: 'test', detail: 'test', savingsUsd: 1 }],
      totalPotentialSavingsUsd: 1,
    }, 'other-instance');

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
