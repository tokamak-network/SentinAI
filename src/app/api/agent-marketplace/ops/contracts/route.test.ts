import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getContractsStatusMock: vi.fn(),
}));

vi.mock('@/lib/agent-marketplace/contracts-status', () => ({
  getAgentMarketplaceContractsStatus: hoisted.getContractsStatusMock,
}));

const { GET } = await import('@/app/api/agent-marketplace/ops/contracts/route');

describe('/api/agent-marketplace/ops/contracts', () => {
  it('returns canonical contract ABI status metadata', async () => {
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

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.registry.name).toBe('ERC8004 Agent Registry');
    expect(body.reputation.eventNames).toEqual(['MerkleRootSubmitted', 'RootSubmitted']);
  });
});
