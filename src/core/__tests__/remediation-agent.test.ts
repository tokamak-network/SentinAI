import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemediationAgent } from '@/core/agents/remediation-agent';
import type { AgentEvent, AgentEventHandler } from '@/core/agent-event-bus';

// ============================================================
// Mocks
// ============================================================

const handlers: Record<string, AgentEventHandler[]> = {};
const mockBusEmit = vi.fn();

vi.mock('@/core/agent-event-bus', () => ({
  getAgentEventBus: () => ({
    emit: mockBusEmit,
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

const mockCanRefill = vi.fn();
const mockRefillEOA = vi.fn();
vi.mock('@/lib/eoa-balance-monitor', () => ({
  canRefill: (...args: unknown[]) => mockCanRefill(...args),
  refillEOA: (...args: unknown[]) => mockRefillEOA(...args),
}));

const mockExecuteFailover = vi.fn().mockResolvedValue({ fromUrl: 'https://old.rpc', toUrl: 'https://new.rpc' });
vi.mock('@/lib/l1-rpc-failover', () => ({
  getSentinaiL1RpcUrl: () => 'https://l1.test',
  executeFailover: (...args: unknown[]) => mockExecuteFailover(...args),
}));

vi.mock('@/chains', () => ({
  getChainPlugin: () => ({
    eoaConfigs: [
      { role: 'batcher', addressEnvVar: 'BATCHER_EOA_ADDRESS' },
      { role: 'proposer', addressEnvVar: 'PROPOSER_EOA_ADDRESS' },
    ],
  }),
}));

// ============================================================
// Helpers
// ============================================================

function emit(type: string, payload: Record<string, unknown>, instanceId = 'inst-1'): void {
  const event: AgentEvent = {
    type: type as AgentEvent['type'],
    instanceId,
    payload,
    timestamp: new Date().toISOString(),
    correlationId: 'corr-1',
  };
  for (const handler of handlers[type] || []) {
    handler(event);
  }
}

// ============================================================
// Tests
// ============================================================

describe('RemediationAgent', () => {
  let agent: RemediationAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(handlers).forEach(k => delete handlers[k]);
    process.env.BATCHER_EOA_ADDRESS = '0xBatcherAddr';
    process.env.PROPOSER_EOA_ADDRESS = '0xProposerAddr';

    agent = new RemediationAgent({ instanceId: 'inst-1' });
  });

  afterEach(() => {
    agent.stop();
    delete process.env.BATCHER_EOA_ADDRESS;
    delete process.env.PROPOSER_EOA_ADDRESS;
  });

  it('should subscribe to 3 event types on start', () => {
    agent.start();
    expect(handlers['security-alert']?.length).toBe(1);
    expect(handlers['reliability-issue']?.length).toBe(1);
    expect(handlers['rca-result']?.length).toBe(1);
  });

  it('should unsubscribe on stop', () => {
    agent.start();
    agent.stop();
    expect(handlers['security-alert']?.length).toBe(0);
    expect(handlers['reliability-issue']?.length).toBe(0);
    expect(handlers['rca-result']?.length).toBe(0);
  });

  it('should execute EOA refill on security-alert with eoa-balance type', async () => {
    mockCanRefill.mockResolvedValue({ allowed: true });
    mockRefillEOA.mockResolvedValue({
      success: true,
      txHash: '0xabc',
      previousBalanceEth: 0.05,
      newBalanceEth: 0.55,
    });

    agent.start();
    emit('security-alert', {
      alerts: [{ type: 'eoa-balance', metric: 'batcher_balance', value: 0.05, detail: 'critical' }],
      alertCount: 1,
    });

    // Wait for async handler
    await vi.waitFor(() => expect(mockRefillEOA).toHaveBeenCalled());

    expect(mockCanRefill).toHaveBeenCalledWith('https://l1.test', '0xBatcherAddr');
    expect(agent.getActionCount()).toBe(1);
    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'remediation-complete',
        payload: expect.objectContaining({ trigger: 'security-alert', successCount: 1 }),
      })
    );
  });

  it('should skip refill when canRefill returns denied', async () => {
    mockCanRefill.mockResolvedValue({ allowed: false, reason: 'cooldown' });

    agent.start();
    emit('security-alert', {
      alerts: [{ type: 'eoa-balance', metric: 'proposer_balance', value: 0.08, detail: 'critical' }],
      alertCount: 1,
    });

    await vi.waitFor(() => expect(mockCanRefill).toHaveBeenCalled());

    expect(mockRefillEOA).not.toHaveBeenCalled();
    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'remediation-complete',
        payload: expect.objectContaining({ failureCount: 1 }),
      })
    );
  });

  it('should execute L1 failover on reliability-issue', async () => {
    agent.start();
    emit('reliability-issue', {
      issues: [{ type: 'l1-rpc-unhealthy', detail: 'health check failed' }],
      issueCount: 1,
    });

    await vi.waitFor(() => expect(mockExecuteFailover).toHaveBeenCalled());

    expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'remediation-complete',
        payload: expect.objectContaining({ trigger: 'reliability-issue', successCount: 1 }),
      })
    );
  });

  it('should handle rca-result and emit remediation-complete', async () => {
    agent.start();
    emit('rca-result', {
      rcaResult: {
        rootCause: { component: 'op-geth', description: 'OOM', confidence: 0.9 },
        remediations: [{ action: 'restart pod', priority: 'high' }],
      },
      triggeredBy: 'anomaly-detected',
    });

    await vi.waitFor(() => expect(mockBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'remediation-complete',
        payload: expect.objectContaining({ trigger: 'rca-result' }),
      })
    ));
  });

  it('should ignore events from other instances', async () => {
    mockCanRefill.mockResolvedValue({ allowed: true });
    mockRefillEOA.mockResolvedValue({ success: true });

    agent.start();
    emit('security-alert', {
      alerts: [{ type: 'eoa-balance', metric: 'batcher_balance', value: 0.05, detail: 'critical' }],
    }, 'other-instance');

    // Give time for handler
    await new Promise(r => setTimeout(r, 50));
    expect(mockCanRefill).not.toHaveBeenCalled();
  });
});
