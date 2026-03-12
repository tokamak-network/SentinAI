import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = new Map<string, string[]>();

  return {
    state,
    redisRpushMock: vi.fn(async (key: string, value: string) => {
      const current = state.get(key) ?? [];
      current.push(value);
      state.set(key, current);
      return current.length;
    }),
    redisLrangeMock: vi.fn(async (key: string, start: number, end: number) => {
      const current = state.get(key) ?? [];
      const normalizedEnd = end < 0 ? current.length + end + 1 : end + 1;
      return current.slice(start, normalizedEnd);
    }),
    redisDelMock: vi.fn(async (key: string) => {
      state.delete(key);
      return 1;
    }),
  };
});

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    rpush: hoisted.redisRpushMock,
    lrange: hoisted.redisLrangeMock,
    del: hoisted.redisDelMock,
  })),
}));
import {
  clearAgentMarketplaceRequestLogs,
  recordAgentMarketplaceRequest,
} from '@/lib/agent-marketplace/request-log-store';
import { summarizeAgentMarketplaceSla } from '@/lib/agent-marketplace/sla-tracker';

describe('agent-marketplace sla-tracker', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    hoisted.state.clear();
    process.env.REDIS_URL = 'redis://localhost:6379';
    (globalThis as typeof globalThis & {
      __sentinai_agent_marketplace_request_log_redis?: unknown;
    }).__sentinai_agent_marketplace_request_log_redis = undefined;
    await clearAgentMarketplaceRequestLogs();
  });

  it('calculates success rate and average latency from successful requests only', async () => {
    await recordAgentMarketplaceRequest({
      agentId: 'agent-1',
      serviceKey: 'sequencer_health',
      timestamp: '2026-03-12T00:00:00.000Z',
      latencyMs: 1000,
      verificationResult: 'verified',
      success: true,
    });
    await recordAgentMarketplaceRequest({
      agentId: 'agent-1',
      serviceKey: 'sequencer_health',
      timestamp: '2026-03-12T00:01:00.000Z',
      latencyMs: 1500,
      verificationResult: 'verified',
      success: true,
    });
    await recordAgentMarketplaceRequest({
      agentId: 'agent-1',
      serviceKey: 'sequencer_health',
      timestamp: '2026-03-12T00:02:00.000Z',
      latencyMs: 9999,
      verificationResult: 'rejected',
      success: false,
    });

    const summary = await summarizeAgentMarketplaceSla({
      fromIso: '2026-03-12T00:00:00.000Z',
      toIso: '2026-03-12T23:59:59.999Z',
      previousScores: { 'agent-1': 80 },
    });

    expect(summary.agents[0].successRate).toBeCloseTo(66.67, 1);
    expect(summary.agents[0].averageLatencyMs).toBe(1250);
    expect(summary.agents[0].scoreDelta).toBe(-5);
    expect(summary.agents[0].newScore).toBe(75);
  });

  it('applies a no-success penalty when an agent has only failed requests', async () => {
    await recordAgentMarketplaceRequest({
      agentId: 'agent-2',
      serviceKey: 'incident_summary',
      timestamp: '2026-03-12T00:00:00.000Z',
      latencyMs: 100,
      verificationResult: 'rejected',
      success: false,
    });

    const summary = await summarizeAgentMarketplaceSla({
      fromIso: '2026-03-12T00:00:00.000Z',
      toIso: '2026-03-12T23:59:59.999Z',
      previousScores: { 'agent-2': 50 },
    });

    expect(summary.agents[0].averageLatencyMs).toBeNull();
    expect(summary.agents[0].scoreDelta).toBe(-10);
    expect(summary.agents[0].newScore).toBe(40);
  });

  it('applies a recovery bonus for perfect low-latency service', async () => {
    await recordAgentMarketplaceRequest({
      agentId: 'agent-3',
      serviceKey: 'batch_submission_status',
      timestamp: '2026-03-12T00:00:00.000Z',
      latencyMs: 500,
      verificationResult: 'verified',
      success: true,
    });
    await recordAgentMarketplaceRequest({
      agentId: 'agent-3',
      serviceKey: 'batch_submission_status',
      timestamp: '2026-03-12T00:01:00.000Z',
      latencyMs: 700,
      verificationResult: 'verified',
      success: true,
    });

    const summary = await summarizeAgentMarketplaceSla({
      fromIso: '2026-03-12T00:00:00.000Z',
      toIso: '2026-03-12T23:59:59.999Z',
      previousScores: { 'agent-3': 90 },
    });

    expect(summary.agents[0].successRate).toBe(100);
    expect(summary.agents[0].averageLatencyMs).toBe(600);
    expect(summary.agents[0].scoreDelta).toBe(2);
    expect(summary.agents[0].newScore).toBe(92);
  });
});
