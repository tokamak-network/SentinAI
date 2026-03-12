import { beforeEach, describe, expect, it } from 'vitest';
import {
  agentMarketplaceRegistryContract,
  agentMarketplaceRegistryCanonicalEvent,
  agentMarketplaceRegistryEventNames,
} from '@/lib/agent-marketplace/abi/agent-registry';
import {
  agentMarketplaceReputationRegistryContract,
  agentMarketplaceReputationRegistryEventNames,
} from '@/lib/agent-marketplace/abi/reputation-registry';
import { getAgentMarketplaceContractsStatus } from '@/lib/agent-marketplace/contracts-status';

describe('agent-marketplace contracts-status', () => {
  beforeEach(() => {
    delete process.env.ERC8004_REGISTRY_ADDRESS;
    delete process.env.MARKETPLACE_REPUTATION_REGISTRY_ADDRESS;
  });

  it('exports canonical ABI metadata for registry and reputation contracts', () => {
    expect(agentMarketplaceRegistryContract.name).toBe('ERC8004 Agent Registry');
    expect(agentMarketplaceRegistryCanonicalEvent).toBe(
      'event AgentRegistered(uint256 indexed agentId, address indexed agent, string agentURI)'
    );
    expect(agentMarketplaceRegistryContract.canonicalEvent).toBe(
      agentMarketplaceRegistryCanonicalEvent
    );
    expect(agentMarketplaceRegistryEventNames).toEqual([
      'AgentRegistered',
      'Register',
    ]);
    expect(agentMarketplaceReputationRegistryContract.name).toBe('Agent Reputation Registry');
    expect(agentMarketplaceReputationRegistryEventNames).toEqual([
      'MerkleRootSubmitted',
      'RootSubmitted',
    ]);
  });

  it('reports configured addresses and supported event names', () => {
    process.env.ERC8004_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000b1';
    process.env.MARKETPLACE_REPUTATION_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000c1';

    const status = getAgentMarketplaceContractsStatus();

    expect(status.registry.address).toBe('0x00000000000000000000000000000000000000b1');
    expect(status.registry.eventNames).toEqual(['AgentRegistered', 'Register']);
    expect(status.reputation.address).toBe('0x00000000000000000000000000000000000000c1');
    expect(status.reputation.eventNames).toEqual(['MerkleRootSubmitted', 'RootSubmitted']);
  });
});
