import { describe, expect, it } from 'vitest';

describe('facilitator typed data helpers', () => {
  it('builds the expected EIP-712 domain and canonicalizes valid resources', async () => {
    const {
      canonicalizeResource,
      getPaymentAuthorizationDomain,
      getPaymentAuthorizationTypes,
    } = await import('@/lib/marketplace/facilitator/typed-data');

    const domain = getPaymentAuthorizationDomain({
      chainId: 1,
      facilitatorAddress: '0x1111111111111111111111111111111111111111',
    });

    expect(domain).toEqual({
      name: 'SentinAI x402 TON Facilitator',
      version: '1',
      chainId: 1,
      verifyingContract: '0x1111111111111111111111111111111111111111',
    });
    expect(getPaymentAuthorizationTypes().PaymentAuthorization).toEqual([
      { name: 'buyer', type: 'address' },
      { name: 'merchant', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'resource', type: 'string' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
    ]);
    expect(canonicalizeResource('/api/marketplace/sequencer-health/')).toBe('/api/marketplace/sequencer-health');
  });

  it('rejects non-canonical or unsupported resource values', async () => {
    const { canonicalizeResource } = await import('@/lib/marketplace/facilitator/typed-data');

    expect(() => canonicalizeResource('https://sentinai.example/api/marketplace/sequencer-health')).toThrow(/origin/i);
    expect(() => canonicalizeResource('/api/marketplace/sequencer-health?foo=bar')).toThrow(/query/i);
    expect(() => canonicalizeResource('/api/marketplace//sequencer-health')).toThrow(/slash/i);
    expect(() => canonicalizeResource('/api/private/secret')).toThrow(/marketplace/i);
  });
});
