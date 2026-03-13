import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const hoisted = vi.hoisted(() => ({
  getCatalogMock: vi.fn(),
  getContractsStatusMock: vi.fn(),
  getRegistryBrowseDataMock: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));

vi.mock('@/lib/agent-marketplace/catalog', () => ({
  getAgentMarketplaceCatalog: hoisted.getCatalogMock,
}));

vi.mock('@/lib/agent-marketplace/contracts-status', () => ({
  getAgentMarketplaceContractsStatus: hoisted.getContractsStatusMock,
}));

vi.mock('@/lib/agent-marketplace/registry-browse', () => ({
  getAgentMarketplaceRegistryBrowseData: hoisted.getRegistryBrowseDataMock,
}));

const MarketplacePage = (await import('@/app/marketplace/page')).default;

describe('/marketplace page', () => {
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
          payment: {
            scheme: 'exact',
            network: 'eip155:1',
            token: 'ton',
            amount: '100000000000000000',
          },
        },
        {
          key: 'incident_summary',
          state: 'active',
          displayName: 'Incident Summary',
          description: 'Current incident state and recent reliability summary',
          payment: {
            scheme: 'exact',
            network: 'eip155:1',
            token: 'ton',
            amount: '150000000000000000',
          },
        },
      ],
      updatedAt: '2026-03-12T00:00:00.000Z',
      acceptableUsePolicyVersion: '2026-03-11',
    });

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

    hoisted.getRegistryBrowseDataMock.mockResolvedValue({
      ok: true,
      status: 'Loaded 2 registry entries',
      totalRows: 2,
      page: 1,
      pageSize: 5,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
      rows: [
        {
          agentId: '7',
          agent: '0x00000000000000000000000000000000000000a7',
          agentUri: 'https://alpha.example/api/agent-marketplace/agent.json',
          manifestStatus: 'ok',
          manifest: {
            name: 'Alpha Instance',
            version: '2026-03-13',
            endpoint: '/api/agent-marketplace',
            capabilities: ['sequencer_health', 'incident_summary'],
            payment: {
              network: 'eip155:11155111',
            },
          },
        },
        {
          agentId: '8',
          agent: '0x00000000000000000000000000000000000000a8',
          agentUri: 'https://beta.example/api/agent-marketplace/agent.json',
          manifestStatus: 'unavailable',
          manifest: null,
        },
      ],
    });
  });

  it('defaults to the registry tab when no tab is provided', async () => {
    process.env.MARKETPLACE_ENABLED = 'true';

    const html = renderToStaticMarkup(await MarketplacePage({}));

    expect(html).toContain('SentinAI Marketplace');
    expect(html).toContain('BROWSE REGISTRY');
    expect(html).toContain('BUYER SANDBOX');
    expect(html).toContain('REGISTERED');
    expect(html).toContain('Alpha Instance');
    expect(html).toContain('manifest unavailable');
    expect(html).toContain('PAGE 1 / 1');
    expect(html).not.toContain('LIVE SERVICES');
    expect(html).not.toContain('HOW TO BUY DATA WITH x402');
    expect(html).toContain('/api/agent-marketplace/catalog');
  });

  it('renders an empty-state note when registry browse returns no rows', async () => {
    process.env.MARKETPLACE_ENABLED = 'true';
    hoisted.getRegistryBrowseDataMock.mockResolvedValueOnce({
      ok: false,
      status: 'Registry browse is not configured',
      totalRows: 0,
      page: 1,
      pageSize: 5,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
      rows: [],
    });

    const html = renderToStaticMarkup(await MarketplacePage({}));

    expect(html).toContain('Registry browse is not configured');
    expect(html).toContain('No registry entries discovered yet');
  });

  it('renders paginated registry navigation when page=2', async () => {
    process.env.MARKETPLACE_ENABLED = 'true';
    hoisted.getRegistryBrowseDataMock.mockResolvedValueOnce({
      ok: true,
      status: 'Loaded 6 registry entries',
      totalRows: 6,
      page: 2,
      pageSize: 5,
      totalPages: 2,
      hasPreviousPage: true,
      hasNextPage: false,
      rows: [
        {
          agentId: '1',
          agent: '0x0000000000000000000000000000000000000001',
          agentUri: 'https://zeta.example/api/agent-marketplace/agent.json',
          manifestStatus: 'ok',
          manifest: {
            name: 'Zeta Instance',
            version: '2026-03-13',
            endpoint: '/api/agent-marketplace',
            capabilities: ['sequencer_health'],
            payment: {
              network: 'eip155:11155111',
            },
          },
        },
      ],
    });

    const html = renderToStaticMarkup(
      await MarketplacePage({
        searchParams: Promise.resolve({ tab: 'registry', page: '2' }),
      })
    );

    expect(html).toContain('Zeta Instance');
    expect(html).toContain('PAGE 2 / 2');
    expect(html).toContain('/marketplace?tab=registry&amp;page=1');
    expect(html).not.toContain('Alpha Instance');
  });

  it('renders a disabled banner when the marketplace is not enabled', async () => {
    const html = renderToStaticMarkup(await MarketplacePage({}));

    expect(html).toContain('MARKETPLACE DISABLED');
    expect(html).toContain('MARKETPLACE_ENABLED=true');
  });

  it('renders the instance tab when tab=instance', async () => {
    process.env.MARKETPLACE_ENABLED = 'true';

    const html = renderToStaticMarkup(
      await MarketplacePage({
        searchParams: Promise.resolve({ tab: 'instance' }),
      })
    );

    expect(html).toContain('LIVE SERVICES');
    expect(html).toContain('Sequencer Health');
    expect(html).toContain('Incident Summary');
    expect(html).toContain('ERC8004 Agent Registry');
    expect(html).not.toContain('REGISTERED');
    expect(html).not.toContain('HOW TO BUY DATA WITH x402');
  });

  it('renders the guide tab when tab=guide', async () => {
    process.env.MARKETPLACE_ENABLED = 'true';

    const html = renderToStaticMarkup(
      await MarketplacePage({
        searchParams: Promise.resolve({ tab: 'guide' }),
      })
    );

    expect(html).toContain('HOW TO BUY DATA WITH x402');
    expect(html).toContain('X-PAYMENT');
    expect(html).toContain('/api/agent-marketplace/agent.json');
    expect(html).not.toContain('LIVE SERVICES');
    expect(html).not.toContain('REGISTERED');
  });

  it('renders the buyer sandbox tab when tab=sandbox', async () => {
    process.env.MARKETPLACE_ENABLED = 'true';

    const html = renderToStaticMarkup(
      await MarketplacePage({
        searchParams: Promise.resolve({ tab: 'sandbox' }),
      })
    );

    expect(html).toContain('BUYER SANDBOX');
    expect(html).toContain('buyer agent id');
    expect(html).toContain('service');
    expect(html).toContain('sample x-payment envelope');
    expect(html).toContain('/api/agent-marketplace/sequencer-health');
    expect(html).not.toContain('REGISTERED');
    expect(html).not.toContain('LIVE SERVICES');
  });

  it('falls back to the registry tab for invalid tab values', async () => {
    process.env.MARKETPLACE_ENABLED = 'true';

    const html = renderToStaticMarkup(
      await MarketplacePage({
        searchParams: Promise.resolve({ tab: 'unknown' }),
      })
    );

    expect(html).toContain('REGISTERED');
    expect(html).not.toContain('LIVE SERVICES');
    expect(html).not.toContain('HOW TO BUY DATA WITH x402');
  });
});
