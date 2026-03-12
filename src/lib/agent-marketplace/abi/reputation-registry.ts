import { parseAbi } from 'viem';

export const agentMarketplaceReputationRegistryEventNames = [
  'MerkleRootSubmitted',
  'RootSubmitted',
] as const;

export const agentMarketplaceReputationRegistryAbi = parseAbi([
  'function submitMerkleRoot(address[] agentIds, uint8[] newScores, bytes32 root, string batchHash)',
  'event MerkleRootSubmitted(bytes32 indexed merkleRoot, string batchHash)',
  'event RootSubmitted(bytes32 indexed root, string batchHash)',
]);

export const agentMarketplaceReputationRegistryContract = {
  name: 'Agent Reputation Registry',
  abi: agentMarketplaceReputationRegistryAbi,
  eventNames: [...agentMarketplaceReputationRegistryEventNames],
} as const;
