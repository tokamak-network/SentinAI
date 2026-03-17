import { parseAbi } from 'viem';

export const agentMarketplaceRegistryCanonicalEvent =
  'event AgentRegistered(uint256 indexed agentId, address indexed agent, string agentURI)';

export const agentMarketplaceRegistryEventNames = [
  'AgentRegistered',
  'Register',
] as const;

export const agentMarketplaceRegistryAbi = parseAbi([
  'function register(string agentURI)',
  'function latestAgentIdOf(address agent) view returns (uint256)',
  'function agentUriOf(uint256 agentId) view returns (string)',
  agentMarketplaceRegistryCanonicalEvent,
  'event Register(address indexed agent, string agentURI)',
]);

export const agentMarketplaceRegistryContract = {
  name: 'ERC8004 Agent Registry',
  abi: agentMarketplaceRegistryAbi,
  canonicalEvent: agentMarketplaceRegistryCanonicalEvent,
  eventNames: [...agentMarketplaceRegistryEventNames],
} as const;
