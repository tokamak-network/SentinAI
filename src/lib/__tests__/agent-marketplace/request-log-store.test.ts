import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = new Map<string, string[]>();

  return {
    state,
    redisCtorMock: vi.fn(),
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
  default: vi.fn().mockImplementation((...args: unknown[]) => {
    hoisted.redisCtorMock(...args);

    return {
      rpush: hoisted.redisRpushMock,
      lrange: hoisted.redisLrangeMock,
      del: hoisted.redisDelMock,
    };
  }),
}));
import {
  clearAgentMarketplaceRequestLogs,
  getAgentMarketplaceRequestLogs,
  getAgentMarketplaceRequestLogsByWindow,
  recordAgentMarketplaceRequest,
} from '@/lib/agent-marketplace/request-log-store';

describe('agent-marketplace request-log-store', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    hoisted.state.clear();
    delete process.env.REDIS_URL;
    (globalThis as typeof globalThis & {
      __sentinai_agent_marketplace_request_log_redis?: unknown;
    }).__sentinai_agent_marketplace_request_log_redis = undefined;
    await clearAgentMarketplaceRequestLogs();
  });

  it('fails closed when REDIS_URL is missing', async () => {
    await expect(getAgentMarketplaceRequestLogs()).rejects.toThrow('REDIS_URL is required');
    await expect(
      recordAgentMarketplaceRequest({
        agentId: 'agent-1',
        serviceKey: 'sequencer_health',
        timestamp: '2026-03-12T00:00:00.000Z',
        latencyMs: 120,
        verificationResult: 'verified',
        success: true,
      })
    ).rejects.toThrow('REDIS_URL is required');
  });

  it('records a successful paid request', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    await recordAgentMarketplaceRequest({
      agentId: 'agent-1',
      serviceKey: 'sequencer_health',
      timestamp: '2026-03-12T00:00:00.000Z',
      latencyMs: 120,
      verificationResult: 'verified',
      success: true,
    });

    const logs = await getAgentMarketplaceRequestLogs();

    expect(logs).toHaveLength(1);
    expect(logs[0].agentId).toBe('agent-1');
    expect(logs[0].verificationResult).toBe('verified');
  });

  it('records failed verification attempts', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    await recordAgentMarketplaceRequest({
      agentId: 'unknown',
      serviceKey: 'incident_summary',
      timestamp: '2026-03-12T00:00:00.000Z',
      latencyMs: 15,
      verificationResult: 'rejected',
      success: false,
    });

    const logs = await getAgentMarketplaceRequestLogs();

    expect(logs).toHaveLength(1);
    expect(logs[0].success).toBe(false);
    expect(logs[0].verificationResult).toBe('rejected');
  });

  it('filters logs by time window', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    await recordAgentMarketplaceRequest({
      agentId: 'agent-old',
      serviceKey: 'sequencer_health',
      timestamp: '2026-03-11T00:00:00.000Z',
      latencyMs: 120,
      verificationResult: 'verified',
      success: true,
    });
    await recordAgentMarketplaceRequest({
      agentId: 'agent-new',
      serviceKey: 'sequencer_health',
      timestamp: '2026-03-12T00:00:00.000Z',
      latencyMs: 140,
      verificationResult: 'verified',
      success: true,
    });

    const logs = await getAgentMarketplaceRequestLogsByWindow({
      fromIso: '2026-03-11T12:00:00.000Z',
      toIso: '2026-03-12T00:05:00.000Z',
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].agentId).toBe('agent-new');
  });
});
