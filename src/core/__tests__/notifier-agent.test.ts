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

function parseFetchBody(callIndex = 0): { text: string; blocks: Array<Record<string, unknown>> } {
  const [, options] = mockFetch.mock.calls[callIndex];
  return JSON.parse(options.body as string);
}

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

  // ----------------------------------------------------------
  // Subscription management
  // ----------------------------------------------------------

  it('should subscribe to 3 event types on start (no cost-insight)', () => {
    agent.start();
    expect(handlers['cost-insight']).toBeUndefined();
    expect(handlers['scaling-recommendation']?.length).toBe(1);
    expect(handlers['verification-complete']?.length).toBe(1);
    expect(handlers['remediation-complete']?.length).toBe(1);
  });

  it('should unsubscribe on stop', () => {
    agent.start();
    agent.stop();
    expect(handlers['scaling-recommendation']?.length).toBe(0);
    expect(handlers['verification-complete']?.length).toBe(0);
    expect(handlers['remediation-complete']?.length).toBe(0);
  });

  // ----------------------------------------------------------
  // Scaling recommendation — only notify on EXECUTED
  // ----------------------------------------------------------

  it('should notify when scaling schedule is actually executed', async () => {
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
    });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(blocksText()).toContain('2 → 1 vCPU');
    expect(blocksText()).toContain('$10.29');
  });

  it('should NOT notify when scaling schedule is created but not executed', async () => {
    agent.start();
    emit('scaling-recommendation', {
      source: 'cost-insight',
      type: 'schedule',
      profile: { id: 's', avgDailyVcpu: 1.5, estimatedMonthlySavings: 10, coveragePct: 85 },
      execution: { executed: false, previousVcpu: 2, targetVcpu: 2, message: 'already at target', skippedReason: 'already-at-target' },
    });

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Verification — only notify on FAILURE
  // ----------------------------------------------------------

  it('should notify on verification failure', async () => {
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
    expect(parseFetchBody().text).toContain('Action Required');
    expect(blocksText()).toContain('4 vCPU');
  });

  it('should NOT notify on verification success', async () => {
    agent.start();
    emit('verification-complete', {
      operationRecord: { executed: true, passed: true, detail: 'ok', expectedVcpu: 4, observedVcpu: 4 },
    });

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Remediation — only notify on FAILURE
  // ----------------------------------------------------------

  it('should notify on remediation failure', async () => {
    agent.start();
    emit('remediation-complete', {
      trigger: 'security-alert',
      results: [
        { action: 'eoa-refill', success: false, detail: 'insufficient treasury balance' },
      ],
      successCount: 0,
      failureCount: 1,
    });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(parseFetchBody().text).toContain('Action Required');
    expect(blocksText()).toContain('eoa-refill');
    expect(blocksText()).toContain('insufficient treasury');
  });

  it('should NOT notify on remediation success', async () => {
    agent.start();
    emit('remediation-complete', {
      trigger: 'security-alert',
      results: [
        { action: 'eoa-refill', success: true, detail: 'batcher refilled: 0.05 → 0.55 ETH' },
      ],
      successCount: 1,
      failureCount: 0,
    });

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Cooldown
  // ----------------------------------------------------------

  it('should suppress duplicate notifications within cooldown window', async () => {
    agent.start();

    // First failure → should send
    emit('remediation-complete', {
      trigger: 'test',
      results: [{ action: 'test', success: false, detail: 'fail' }],
      successCount: 0,
      failureCount: 1,
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    // Second failure immediately → suppressed by cooldown
    emit('remediation-complete', {
      trigger: 'test',
      results: [{ action: 'test', success: false, detail: 'fail again' }],
      successCount: 0,
      failureCount: 1,
    });
    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Different event type → independent cooldown, should send
    emit('verification-complete', {
      operationRecord: { executed: true, passed: false, detail: 'mismatch', expectedVcpu: 4, observedVcpu: 1 },
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  // ----------------------------------------------------------
  // Instance isolation
  // ----------------------------------------------------------

  it('should ignore events from other instances', async () => {
    agent.start();
    emit('remediation-complete', {
      trigger: 'test',
      results: [{ action: 'test', success: false, detail: 'fail' }],
      successCount: 0,
      failureCount: 1,
    }, 'other-instance');

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
