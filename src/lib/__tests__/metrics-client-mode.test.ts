import { describe, it, expect } from 'vitest';

// Inline the logic extracted from the metrics route for unit testing.
// This mirrors: clientMode: clientProfile.clientFamily === 'unknown' ? 'partial' : 'full'
function getClientMode(family: string): 'partial' | 'full' {
  return family === 'unknown' ? 'partial' : 'full';
}

describe('getClientMode', () => {
  it('returns "full" when clientFamily is "geth"', () => {
    expect(getClientMode('geth')).toBe('full');
  });

  it('returns "full" when clientFamily is "reth"', () => {
    expect(getClientMode('reth')).toBe('full');
  });

  it('returns "full" when clientFamily is "nethermind"', () => {
    expect(getClientMode('nethermind')).toBe('full');
  });

  it('returns "full" when clientFamily is "besu"', () => {
    expect(getClientMode('besu')).toBe('full');
  });

  it('returns "full" when clientFamily is "erigon"', () => {
    expect(getClientMode('erigon')).toBe('full');
  });

  it('returns "full" when clientFamily is "op-geth"', () => {
    expect(getClientMode('op-geth')).toBe('full');
  });

  it('returns "full" when clientFamily is "nitro-node"', () => {
    expect(getClientMode('nitro-node')).toBe('full');
  });

  it('returns "partial" when clientFamily is "unknown"', () => {
    expect(getClientMode('unknown')).toBe('partial');
  });
});
