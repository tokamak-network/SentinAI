import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const hoisted = vi.hoisted(() => ({
  buildSummaryMock: vi.fn(),
  listDisputesMock: vi.fn(),
  getContractsStatusMock: vi.fn(),
}));

vi.mock('@/lib/agent-marketplace/ops-summary', () => ({
  buildAgentMarketplaceOpsSummary: hoisted.buildSummaryMock,
}));

vi.mock('@/lib/agent-marketplace/dispute-store', () => ({
  listAgentMarketplaceDisputes: hoisted.listDisputesMock,
}));

vi.mock('@/lib/agent-marketplace/contracts-status', () => ({
  getAgentMarketplaceContractsStatus: hoisted.getContractsStatusMock,
}));

const Loading = (await import('@/app/v2/marketplace/loading')).default;
const Page = (await import('@/app/v2/marketplace/page')).default;

describe('/v2/marketplace page', () => {
  it('renders a loading shell', () => {
    const html = renderToStaticMarkup(Loading());

    expect(html).toContain('Loading marketplace ops');
  });

  it('renders the disabled banner when marketplace is disabled', async () => {
    hoisted.getContractsStatusMock.mockReturnValue({
      registry: { name: 'ERC8004 Agent Registry', address: null, eventNames: ['AgentRegistered', 'Register'] },
      reputation: { name: 'Agent Reputation Registry', address: null, eventNames: ['MerkleRootSubmitted', 'RootSubmitted'] },
    });
    hoisted.listDisputesMock.mockResolvedValue([]);
    hoisted.buildSummaryMock.mockResolvedValue({
      enabled: false,
      window: {
        fromIso: '2026-03-11T00:00:00.000Z',
        toIso: '2026-03-12T00:00:00.000Z',
      },
      requestTotals: { total: 0, verified: 0, rejected: 0, rateLimited: 0 },
      distinctBuyerCount: 0,
      services: [],
      topBuyers: [],
      recentRequests: [],
      slaAgents: [],
      lastBatch: {
        status: 'never',
        publishedAt: null,
        batchHash: null,
        txHash: null,
        error: null,
      },
    });

    const html = renderToStaticMarkup(await Page());

    expect(html).toContain('MARKETPLACE DISABLED');
    expect(html).toContain('Set MARKETPLACE_ENABLED=true');
  });

  it('renders summary cards, services, and recent verified requests when enabled', async () => {
    hoisted.getContractsStatusMock.mockReturnValue({
      registry: {
        name: 'ERC8004 Agent Registry',
        address: '0x00000000000000000000000000000000000000b1',
        eventNames: ['AgentRegistered', 'Register'],
      },
      reputation: {
        name: 'Agent Reputation Registry',
        address: '0x00000000000000000000000000000000000000c1',
        eventNames: ['MerkleRootSubmitted', 'RootSubmitted'],
      },
    });
    hoisted.listDisputesMock.mockResolvedValue([
      {
        id: 'disp_1',
        agentId: 'agent-1',
        batchHash: 'QmBatchCid',
        merkleRoot: '0x' + 'a'.repeat(64),
        requestedScore: 82,
        expectedScore: 91,
        reason: 'score mismatch',
        status: 'open',
        createdAt: '2026-03-12T00:00:00.000Z',
        updatedAt: '2026-03-12T00:00:00.000Z',
      },
    ]);
    hoisted.buildSummaryMock.mockResolvedValue({
      enabled: true,
      window: {
        fromIso: '2026-03-11T00:00:00.000Z',
        toIso: '2026-03-12T00:00:00.000Z',
      },
      requestTotals: { total: 4, verified: 2, rejected: 1, rateLimited: 1 },
      distinctBuyerCount: 3,
      services: [
        {
          key: 'sequencer_health',
          displayName: 'Sequencer Health',
          priceAmount: '100000000000000000',
          requestCount: 2,
        },
        {
          key: 'incident_summary',
          displayName: 'Incident Summary',
          priceAmount: '150000000000000000',
          requestCount: 1,
        },
      ],
      topBuyers: [
        { agentId: 'agent-1', requestCount: 2, verifiedCount: 2 },
      ],
      recentRequests: [
        {
          agentId: 'agent-1',
          serviceKey: 'incident_summary',
          serviceDisplayName: 'Incident Summary',
          verificationResult: 'verified',
          success: true,
          latencyMs: 120,
          timestamp: '2026-03-12T00:02:00.000Z',
        },
      ],
      slaAgents: [
        {
          agentId: 'agent-1',
          totalRequests: 2,
          successRate: 100,
          averageLatencyMs: 120,
          scoreDelta: 2,
          newScore: 92,
        },
      ],
      lastBatch: {
        status: 'never',
        publishedAt: null,
        batchHash: null,
        txHash: null,
        error: null,
      },
    });

    const html = renderToStaticMarkup(await Page());

    expect(html).toContain('REQUESTS / 24H');
    expect(html).toContain('BUYERS / 24H');
    expect(html).toContain('LAST BATCH');
    expect(html).toContain('Sequencer Health');
    expect(html).toContain('Incident Summary');
    expect(html).toContain('RECENT VERIFIED REQUESTS');
    expect(html).toContain('DISPUTES');
    expect(html).toContain('CONTRACTS / ABI');
    expect(html).toContain('ERC8004 Agent Registry');
    expect(html).toContain('MerkleRootSubmitted');
    expect(html).toContain('score mismatch');
    expect(html).toContain('open');
    expect(html).toContain('agent-1');
  });

  it('renders an empty disputes state when there are no disputes', async () => {
    hoisted.getContractsStatusMock.mockReturnValue({
      registry: { name: 'ERC8004 Agent Registry', address: null, eventNames: ['AgentRegistered', 'Register'] },
      reputation: { name: 'Agent Reputation Registry', address: null, eventNames: ['MerkleRootSubmitted', 'RootSubmitted'] },
    });
    hoisted.listDisputesMock.mockResolvedValue([]);
    hoisted.buildSummaryMock.mockResolvedValue({
      enabled: true,
      window: {
        fromIso: '2026-03-11T00:00:00.000Z',
        toIso: '2026-03-12T00:00:00.000Z',
      },
      requestTotals: { total: 0, verified: 0, rejected: 0, rateLimited: 0 },
      distinctBuyerCount: 0,
      services: [],
      topBuyers: [],
      recentRequests: [],
      slaAgents: [],
      lastBatch: {
        status: 'never',
        publishedAt: null,
        batchHash: null,
        txHash: null,
        error: null,
      },
    });

    const html = renderToStaticMarkup(await Page());

    expect(html).toContain('No open disputes.');
  });

  it('renders clear missing-config contract status when addresses are absent', async () => {
    hoisted.getContractsStatusMock.mockReturnValue({
      registry: { name: 'ERC8004 Agent Registry', address: null, eventNames: ['AgentRegistered', 'Register'] },
      reputation: { name: 'Agent Reputation Registry', address: null, eventNames: ['MerkleRootSubmitted', 'RootSubmitted'] },
    });
    hoisted.listDisputesMock.mockResolvedValue([]);
    hoisted.buildSummaryMock.mockResolvedValue({
      enabled: true,
      window: {
        fromIso: '2026-03-11T00:00:00.000Z',
        toIso: '2026-03-12T00:00:00.000Z',
      },
      requestTotals: { total: 0, verified: 0, rejected: 0, rateLimited: 0 },
      distinctBuyerCount: 0,
      services: [],
      topBuyers: [],
      recentRequests: [],
      slaAgents: [],
      lastBatch: {
        status: 'never',
        publishedAt: null,
        batchHash: null,
        txHash: null,
        error: null,
      },
    });

    const html = renderToStaticMarkup(await Page());

    expect(html).toContain('missing');
    expect(html).toContain('AgentRegistered');
    expect(html).toContain('RootSubmitted');
  });
});
