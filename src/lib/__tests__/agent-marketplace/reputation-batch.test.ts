import { describe, expect, it } from 'vitest';
import { keccak256, encodePacked } from 'viem';
import {
  buildAgentMarketplaceReputationBatch,
  clampReputationScore,
} from '@/lib/agent-marketplace/reputation-batch';

describe('agent-marketplace reputation-batch', () => {
  it('clamps scores into the 0-100 range', () => {
    expect(clampReputationScore(-10)).toBe(0);
    expect(clampReputationScore(42)).toBe(42);
    expect(clampReputationScore(120)).toBe(100);
  });

  it('builds deterministic leaves from agentId, score, and batch timestamp', () => {
    const batch = buildAgentMarketplaceReputationBatch({
      batchTimestamp: 1710201600,
      agents: [
        { agentId: '0x00000000000000000000000000000000000000a1', score: 92 },
      ],
    });

    const expectedLeaf = keccak256(encodePacked(
      ['address', 'uint8', 'uint256'],
      ['0x00000000000000000000000000000000000000a1', 92, 1710201600n]
    ));

    expect(batch.leaves).toHaveLength(1);
    expect(batch.leaves[0].leaf).toBe(expectedLeaf);
    expect(batch.root).toBe(expectedLeaf);
  });

  it('builds a merkle-ready export with deterministic root and proofs', () => {
    const batch = buildAgentMarketplaceReputationBatch({
      batchTimestamp: 1710201600,
      agents: [
        { agentId: '0x00000000000000000000000000000000000000a1', score: 92 },
        { agentId: '0x00000000000000000000000000000000000000a2', score: 75 },
        { agentId: '0x00000000000000000000000000000000000000a3', score: 101 },
      ],
    });

    expect(batch.algorithm).toBe('keccak256');
    expect(batch.leaves).toHaveLength(3);
    expect(batch.leaves[2].score).toBe(100);
    expect(batch.root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(batch.proofs['0x00000000000000000000000000000000000000a1'].length).toBeGreaterThan(0);
    expect(batch.proofs['0x00000000000000000000000000000000000000a2'].length).toBeGreaterThan(0);
    expect(batch.proofs['0x00000000000000000000000000000000000000a3'].length).toBeGreaterThan(0);
  });
});
