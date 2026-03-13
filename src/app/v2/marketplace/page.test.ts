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
        merkleRoot: null,
        error: null,
      },
      batchHistory: [],
    });

    const html = renderToStaticMarkup(await Page({}));

    expect(html).toContain('MARKETPLACE DISABLED');
    expect(html).toContain('Set MARKETPLACE_ENABLED=true');
  });

  it('renders summary cards, services, and recent verified requests when enabled', async () => {
    process.env.MARKETPLACE_AGENT_URI_BASE = 'https://sentinai.example.com';
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
        merkleRoot: null,
        error: null,
      },
      batchHistory: [],
    });

    const html = renderToStaticMarkup(await Page({}));

    expect(html).toContain('REQUESTS / 24H');
    expect(html).toContain('BUYERS / 24H');
    expect(html).toContain('LAST BATCH');
    expect(html).toContain('Sequencer Health');
    expect(html).toContain('Incident Summary');
    expect(html).toContain('RECENT VERIFIED REQUESTS');
    expect(html).toContain('DISPUTES');
    expect(html).toContain('CONTRACTS / ABI');
    expect(html).toContain('LAST BATCH DETAIL');
    expect(html).toContain('REGISTRY REGISTRATION');
    expect(html).toContain('/api/agent-marketplace/agent.json');
    expect(html).toContain('/api/agent-marketplace/ops/register');
    expect(html).toContain('No reputation batch has been published yet.');
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
        merkleRoot: null,
        error: null,
      },
      batchHistory: [],
    });

    const html = renderToStaticMarkup(await Page({}));

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
        merkleRoot: null,
        error: null,
      },
      batchHistory: [],
    });

    const html = renderToStaticMarkup(await Page({}));

    expect(html).toContain('missing');
    expect(html).toContain('AgentRegistered');
    expect(html).toContain('RootSubmitted');
  });

  it('renders the selected dispute detail and batch detail when searchParams match', async () => {
    hoisted.getContractsStatusMock.mockReturnValue({
      registry: { name: 'ERC8004 Agent Registry', address: null, eventNames: ['AgentRegistered', 'Register'] },
      reputation: { name: 'Agent Reputation Registry', address: null, eventNames: ['MerkleRootSubmitted', 'RootSubmitted'] },
    });
    hoisted.listDisputesMock.mockResolvedValue([
      {
        id: 'disp_2',
        agentId: 'agent-2',
        batchHash: 'QmBatchCid2',
        merkleRoot: '0x' + 'b'.repeat(64),
        requestedScore: 67,
        expectedScore: 81,
        reason: 'late recovery',
        status: 'reviewed',
        reviewedBy: 'ops-reviewer',
        reviewerNote: 'Validated against replayed SLA snapshot.',
        history: [
          {
            fromStatus: 'open',
            toStatus: 'reviewed',
            reviewedBy: 'ops-reviewer',
            reviewerNote: 'Validated against replayed SLA snapshot.',
            changedAt: '2026-03-12T03:00:00.000Z',
          },
        ],
        createdAt: '2026-03-12T02:00:00.000Z',
        updatedAt: '2026-03-12T03:00:00.000Z',
      },
      {
        id: 'disp_1',
        agentId: 'agent-1',
        batchHash: 'QmBatchCid1',
        merkleRoot: '0x' + 'a'.repeat(64),
        requestedScore: 82,
        expectedScore: 91,
        reason: 'score mismatch',
        status: 'open',
        createdAt: '2026-03-12T00:00:00.000Z',
        updatedAt: '2026-03-12T01:00:00.000Z',
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
      services: [],
      topBuyers: [],
      recentRequests: [],
      slaAgents: [
        {
          agentId: 'agent-2',
          totalRequests: 3,
          successRate: 66,
          averageLatencyMs: 250,
          scoreDelta: -4,
          newScore: 81,
        },
      ],
      lastBatch: {
        status: 'success',
        publishedAt: '2026-03-12T04:00:00.000Z',
        batchHash: 'QmBatchCid2',
        txHash: '0xtxbatch',
        merkleRoot: '0x' + 'c'.repeat(64),
        error: null,
      },
      batchHistory: [
        {
          status: 'success',
          publishedAt: '2026-03-12T04:00:00.000Z',
          window: {
            fromIso: '2026-03-11T00:00:00.000Z',
            toIso: '2026-03-12T00:00:00.000Z',
          },
          batchHash: 'QmBatchCid2',
          txHash: '0xtxbatch',
          merkleRoot: '0x' + 'c'.repeat(64),
          error: null,
        },
        {
          status: 'failed',
          publishedAt: '2026-03-11T04:00:00.000Z',
          window: {
            fromIso: '2026-03-10T00:00:00.000Z',
            toIso: '2026-03-11T00:00:00.000Z',
          },
          batchHash: null,
          txHash: null,
          merkleRoot: '0x' + 'd'.repeat(64),
          error: 'submit failed',
        },
      ],
    });

    const html = renderToStaticMarkup(
      await Page({
        searchParams: Promise.resolve({
          dispute: 'disp_2',
          batch: '2026-03-11T04:00:00.000Z',
        }),
      })
    );

    expect(html).toContain('DISPUTE DETAIL');
    expect(html).toContain('disp_2');
    expect(html).toContain('late recovery');
    expect(html).toContain('reviewed');
    expect(html).toContain('score delta');
    expect(html).toContain('SLA 66%');
    expect(html).toContain('0xtxbatch');
    expect(html).toContain('QmBatchCid2');
    expect(html).toContain('ops-reviewer');
    expect(html).toContain('Validated against replayed SLA snapshot.');
    expect(html).toContain('UPDATE DISPUTE');
    expect(html).toContain('reviewed by');
    expect(html).toContain('reviewer note');
    expect(html).toContain('Save Review');
    expect(html).toContain('REVIEW HISTORY');
    expect(html).toContain('open → reviewed');
    expect(html).toContain('LAST BATCH HISTORY');
    expect(html).toContain('submit failed');
    expect(html).toContain('2026-03-11T04:00:00.000Z');
    expect(html).toContain('error:</span> submit failed');
    expect(html).not.toContain('tx hash:</span> 0xtxbatch');
    expect(html).toContain('/v2/marketplace?dispute=disp_2&amp;batch=2026-03-11T04%3A00%3A00.000Z');
  });
});
