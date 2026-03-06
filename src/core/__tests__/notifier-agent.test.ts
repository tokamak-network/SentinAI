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

  it('should subscribe to 3 event types on start', () => {
    agent.start();
    expect(handlers['cost-insight']?.length).toBe(1);
    expect(handlers['verification-complete']?.length).toBe(1);
    expect(handlers['remediation-complete']?.length).toBe(1);
  });

  it('should unsubscribe on stop', () => {
    agent.start();
    agent.stop();
    expect(handlers['cost-insight']?.length).toBe(0);
    expect(handlers['verification-complete']?.length).toBe(0);
    expect(handlers['remediation-complete']?.length).toBe(0);
  });

  it('should send Slack notification on cost-insight', async () => {
    agent.start();
    emit('cost-insight', {
      insights: [{ type: 'overprovision', detail: 'Consider downscaling', savingsUsd: 10.5 }],
      totalPotentialSavingsUsd: 10.5,
    });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/test');
    const body = JSON.parse(options.body as string);
    expect(body.text).toContain('Cost Insight');
    expect(body.text).toContain('$10.50');
    expect(agent.getNotificationCount()).toBe(1);
  });

  it('should send Slack notification on verification failure', async () => {
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

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.text).toContain('Verification Failed');
    expect(body.text).toContain('Expected');
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

  it('should send Slack notification on remediation-complete', async () => {
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

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.text).toContain('Remediation Complete');
    expect(body.text).toContain('eoa-refill');
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
