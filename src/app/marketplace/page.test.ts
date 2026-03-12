import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const hoisted = vi.hoisted(() => ({
  getCatalogMock: vi.fn(),
  getContractsStatusMock: vi.fn(),
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
  });

  it('defaults to the registry tab when no tab is provided', async () => {
    process.env.MARKETPLACE_ENABLED = 'true';

    const html = renderToStaticMarkup(await MarketplacePage({}));

    expect(html).toContain('SentinAI Marketplace');
    expect(html).toContain('BROWSE REGISTRY');
    expect(html).toContain('REGISTERED');
    expect(html).not.toContain('LIVE SERVICES');
    expect(html).not.toContain('HOW TO BUY DATA WITH x402');
    expect(html).toContain('/api/agent-marketplace/catalog');
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
