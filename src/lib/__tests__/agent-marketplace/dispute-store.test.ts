import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = new Map<string, string>();

  return {
    state,
    redisCtorMock: vi.fn(),
    redisGetMock: vi.fn(async (key: string) => state.get(key) ?? null),
    redisSetMock: vi.fn(async (key: string, value: string) => {
      state.set(key, value);
      return 'OK';
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
      get: hoisted.redisGetMock,
      set: hoisted.redisSetMock,
      del: hoisted.redisDelMock,
    };
  }),
}));

const {
  createAgentMarketplaceDispute,
  listAgentMarketplaceDisputes,
  updateAgentMarketplaceDisputeStatus,
} = await import('@/lib/agent-marketplace/dispute-store');

describe('agent-marketplace dispute-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.state.clear();
    process.env.REDIS_URL = 'redis://localhost:6379';
    (globalThis as typeof globalThis & {
      __sentinai_agent_marketplace_dispute_redis?: unknown;
    }).__sentinai_agent_marketplace_dispute_redis = undefined;
  });

  it('creates and lists disputes', async () => {
    const created = await createAgentMarketplaceDispute({
      agentId: '0x00000000000000000000000000000000000000a1',
      batchHash: 'QmBatchCid',
      merkleRoot: '0x' + 'a'.repeat(64),
      requestedScore: 82,
      expectedScore: 91,
      reason: 'score mismatch after incident resolution',
    });

    expect(created.status).toBe('open');

    const disputes = await listAgentMarketplaceDisputes();
    expect(disputes).toHaveLength(1);
    expect(disputes[0].agentId).toBe('0x00000000000000000000000000000000000000a1');
    expect(disputes[0].expectedScore).toBe(91);
  });

  it('updates dispute status through allowed transitions', async () => {
    const created = await createAgentMarketplaceDispute({
      agentId: '0x00000000000000000000000000000000000000a1',
      batchHash: 'QmBatchCid',
      merkleRoot: '0x' + 'a'.repeat(64),
      requestedScore: 82,
      expectedScore: 91,
      reason: 'score mismatch after incident resolution',
    });

    const reviewed = await updateAgentMarketplaceDisputeStatus(created.id, 'reviewed', {
      reviewedBy: 'ops@sentinai',
      reviewerNote: 'validated against latest SLA snapshot',
    });
    const resolved = await updateAgentMarketplaceDisputeStatus(created.id, 'resolved');

    expect(reviewed.status).toBe('reviewed');
    expect(reviewed.reviewedBy).toBe('ops@sentinai');
    expect(reviewed.reviewerNote).toBe('validated against latest SLA snapshot');
    expect(reviewed.history).toEqual([
      expect.objectContaining({
        fromStatus: 'open',
        toStatus: 'reviewed',
        reviewedBy: 'ops@sentinai',
        reviewerNote: 'validated against latest SLA snapshot',
      }),
    ]);
    expect(resolved.status).toBe('resolved');
    expect(resolved.history).toHaveLength(2);
    expect(resolved.history[1]).toEqual(
      expect.objectContaining({
        fromStatus: 'reviewed',
        toStatus: 'resolved',
        reviewedBy: null,
        reviewerNote: null,
      })
    );
  });

  it('rejects invalid status transitions', async () => {
    const created = await createAgentMarketplaceDispute({
      agentId: '0x00000000000000000000000000000000000000a1',
      batchHash: 'QmBatchCid',
      merkleRoot: '0x' + 'a'.repeat(64),
      requestedScore: 82,
      expectedScore: 91,
      reason: 'score mismatch after incident resolution',
    });

    await updateAgentMarketplaceDisputeStatus(created.id, 'resolved');

    await expect(
      updateAgentMarketplaceDisputeStatus(created.id, 'reviewed')
    ).rejects.toThrow('Invalid dispute status transition');
  });
});
