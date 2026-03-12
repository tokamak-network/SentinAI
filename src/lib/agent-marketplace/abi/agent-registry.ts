import { parseAbi } from 'viem';

export const agentMarketplaceRegistryEventNames = [
  'AgentRegistered',
  'Register',
] as const;

export const agentMarketplaceRegistryAbi = parseAbi([
  'function register(string agentURI)',
  'event AgentRegistered(uint256 indexed agentId)',
  'event Register(address indexed agent, string agentURI)',
]);

export const agentMarketplaceRegistryContract = {
  name: 'ERC8004 Agent Registry',
  abi: agentMarketplaceRegistryAbi,
  eventNames: [...agentMarketplaceRegistryEventNames],
} as const;
