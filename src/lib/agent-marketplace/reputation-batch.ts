import { encodePacked, keccak256 } from 'viem';

export interface ReputationBatchAgentInput {
  agentId: `0x${string}`;
  score: number;
}

export interface ReputationBatchLeafRecord {
  agentId: `0x${string}`;
  score: number;
  leaf: `0x${string}`;
}

export interface ReputationBatchExport {
  algorithm: 'keccak256';
  batchTimestamp: number;
  leaves: ReputationBatchLeafRecord[];
  root: `0x${string}`;
  proofs: Record<string, `0x${string}`[]>;
}

export function clampReputationScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildLeaf(agentId: `0x${string}`, score: number, batchTimestamp: number): `0x${string}` {
  return keccak256(encodePacked(
    ['address', 'uint8', 'uint256'],
    [agentId, clampReputationScore(score), BigInt(batchTimestamp)]
  ));
}

function buildParent(left: `0x${string}`, right: `0x${string}`): `0x${string}` {
  return keccak256(encodePacked(
    ['bytes32', 'bytes32'],
    [left, right]
  ));
}

function buildLayers(leaves: `0x${string}`[]): `0x${string}`[][] {
  if (leaves.length === 0) {
    return [];
  }

  const layers: `0x${string}`[][] = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const currentLayer = layers[layers.length - 1];
    const nextLayer: `0x${string}`[] = [];

    for (let index = 0; index < currentLayer.length; index += 2) {
      const left = currentLayer[index];
      const right = currentLayer[index + 1] ?? currentLayer[index];
      nextLayer.push(buildParent(left, right));
    }

    layers.push(nextLayer);
  }

  return layers;
}

function buildProofs(
  orderedLeaves: ReputationBatchLeafRecord[],
  layers: `0x${string}`[][]
): Record<string, `0x${string}`[]> {
  const proofs: Record<string, `0x${string}`[]> = {};

  orderedLeaves.forEach((leafRecord, leafIndex) => {
    let index = leafIndex;
    const proof: `0x${string}`[] = [];

    for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
      const layer = layers[layerIndex];
      const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
      const sibling = layer[siblingIndex] ?? layer[index];
      proof.push(sibling);
      index = Math.floor(index / 2);
    }

    proofs[leafRecord.agentId] = proof;
  });

  return proofs;
}

export function buildAgentMarketplaceReputationBatch(input: {
  batchTimestamp: number;
  agents: ReputationBatchAgentInput[];
}): ReputationBatchExport {
  const leaves = input.agents
    .map((agent) => ({
      agentId: agent.agentId,
      score: clampReputationScore(agent.score),
      leaf: buildLeaf(agent.agentId, agent.score, input.batchTimestamp),
    }))
    .sort((left, right) => left.agentId.localeCompare(right.agentId));

  const hashedLeaves = leaves.map((leaf) => leaf.leaf);
  const layers = buildLayers(hashedLeaves);
  const root = layers.length > 0
    ? layers[layers.length - 1][0]
    : keccak256(encodePacked(['string'], ['empty']));

  return {
    algorithm: 'keccak256',
    batchTimestamp: input.batchTimestamp,
    leaves,
    root,
    proofs: buildProofs(leaves, layers),
  };
}
