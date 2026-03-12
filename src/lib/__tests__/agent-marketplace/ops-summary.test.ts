import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getCatalogMock: vi.fn(),
  getLogsByWindowMock: vi.fn(),
  summarizeSlaMock: vi.fn(),
}));

vi.mock('@/lib/agent-marketplace/catalog', () => ({
  getAgentMarketplaceCatalog: hoisted.getCatalogMock,
}));

vi.mock('@/lib/agent-marketplace/request-log-store', () => ({
  getAgentMarketplaceRequestLogsByWindow: hoisted.getLogsByWindowMock,
}));

vi.mock('@/lib/agent-marketplace/sla-tracker', () => ({
  summarizeAgentMarketplaceSla: hoisted.summarizeSlaMock,
}));

const { buildAgentMarketplaceOpsSummary } = await import('@/lib/agent-marketplace/ops-summary');

describe('agent-marketplace ops-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MARKETPLACE_ENABLED;

    hoisted.getCatalogMock.mockReturnValue({
      agent: {
        id: 'sentinai-agent-marketplace',
        status: 'active',
        version: '2026-03-12',
        operator: 'sentinai-operator',
      },
      services: [
        {
          key: 'sequencer_health',
          state: 'active',
          displayName: 'Sequencer Health',
          description: 'Decision-ready execution health snapshot for agent gating',
          payment: { scheme: 'exact', network: 'eip155:1', token: 'ton', amount: '100000000000000000' },
        },
        {
          key: 'incident_summary',
          state: 'active',
          displayName: 'Incident Summary',
          description: 'Current incident state and recent reliability summary',
          payment: { scheme: 'exact', network: 'eip155:1', token: 'ton', amount: '150000000000000000' },
        },
        {
          key: 'batch_submission_status',
          state: 'active',
          displayName: 'Batch Submission Status',
          description: 'Recent batch posting health, lag, and settlement risk',
          payment: { scheme: 'exact', network: 'eip155:1', token: 'ton', amount: '150000000000000000' },
        },
      ],
      updatedAt: '2026-03-12T00:00:00.000Z',
      acceptableUsePolicyVersion: '2026-03-11',
    });
  });

  it('returns zeroed summary when marketplace is disabled', async () => {
    const summary = await buildAgentMarketplaceOpsSummary({
      fromIso: '2026-03-11T00:00:00.000Z',
      toIso: '2026-03-12T00:00:00.000Z',
    });

    expect(summary.enabled).toBe(false);
    expect(summary.requestTotals).toEqual({
      total: 0,
      verified: 0,
      rejected: 0,
      rateLimited: 0,
    });
    expect(summary.distinctBuyerCount).toBe(0);
    expect(summary.services).toEqual([]);
    expect(summary.topBuyers).toEqual([]);
    expect(summary.recentRequests).toEqual([]);
    expect(summary.slaAgents).toEqual([]);
    expect(summary.lastBatch.status).toBe('never');
    expect(hoisted.getLogsByWindowMock).not.toHaveBeenCalled();
  });

  it('builds request, service, buyer, and SLA summary when marketplace is enabled', async () => {
    process.env.MARKETPLACE_ENABLED = 'true';

    hoisted.getLogsByWindowMock.mockResolvedValue([
      {
        agentId: 'agent-1',
        serviceKey: 'sequencer_health',
        timestamp: '2026-03-12T00:01:00.000Z',
        latencyMs: 120,
        verificationResult: 'verified',
        success: true,
      },
      {
        agentId: 'agent-1',
        serviceKey: 'incident_summary',
        timestamp: '2026-03-12T00:02:00.000Z',
        latencyMs: 140,
        verificationResult: 'verified',
        success: true,
      },
      {
        agentId: 'agent-2',
        serviceKey: 'incident_summary',
        timestamp: '2026-03-12T00:03:00.000Z',
        latencyMs: 40,
        verificationResult: 'rejected',
        success: false,
      },
      {
        agentId: 'agent-3',
        serviceKey: 'batch_submission_status',
        timestamp: '2026-03-12T00:04:00.000Z',
        latencyMs: 20,
        verificationResult: 'rate_limited',
        success: false,
      },
    ]);

    hoisted.summarizeSlaMock.mockResolvedValue({
      fromIso: '2026-03-11T00:00:00.000Z',
      toIso: '2026-03-12T00:00:00.000Z',
      agents: [
        {
          agentId: 'agent-1',
          totalRequests: 2,
          successRate: 100,
          averageLatencyMs: 130,
          scoreDelta: 2,
          newScore: 92,
        },
      ],
    });

    const summary = await buildAgentMarketplaceOpsSummary({
      fromIso: '2026-03-11T00:00:00.000Z',
      toIso: '2026-03-12T00:00:00.000Z',
    });

    expect(summary.enabled).toBe(true);
    expect(summary.requestTotals).toEqual({
      total: 4,
      verified: 2,
      rejected: 1,
      rateLimited: 1,
    });
    expect(summary.distinctBuyerCount).toBe(3);
    expect(summary.services).toEqual([
      expect.objectContaining({ key: 'sequencer_health', requestCount: 1, priceAmount: '100000000000000000' }),
      expect.objectContaining({ key: 'incident_summary', requestCount: 2, priceAmount: '150000000000000000' }),
      expect.objectContaining({ key: 'batch_submission_status', requestCount: 1, priceAmount: '150000000000000000' }),
    ]);
    expect(summary.topBuyers).toEqual([
      expect.objectContaining({ agentId: 'agent-1', verifiedCount: 2, requestCount: 2 }),
      expect.objectContaining({ agentId: 'agent-2', verifiedCount: 0, requestCount: 1 }),
      expect.objectContaining({ agentId: 'agent-3', verifiedCount: 0, requestCount: 1 }),
    ]);
    expect(summary.recentRequests).toEqual([
      expect.objectContaining({ agentId: 'agent-1', serviceKey: 'incident_summary', verificationResult: 'verified' }),
      expect.objectContaining({ agentId: 'agent-1', serviceKey: 'sequencer_health', verificationResult: 'verified' }),
    ]);
    expect(summary.slaAgents).toEqual([
      expect.objectContaining({ agentId: 'agent-1', newScore: 92 }),
    ]);
    expect(summary.lastBatch.status).toBe('never');
    expect(hoisted.summarizeSlaMock).toHaveBeenCalledWith({
      fromIso: '2026-03-11T00:00:00.000Z',
      toIso: '2026-03-12T00:00:00.000Z',
      previousScores: {},
    });
  });
});
