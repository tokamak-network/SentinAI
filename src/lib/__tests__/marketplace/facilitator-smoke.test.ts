import { describe, expect, it } from 'vitest';

describe('facilitator smoke helpers', () => {
  it('requires the minimal smoke env contract', async () => {
    const { loadFacilitatorSmokeConfig } = await import('@/lib/marketplace/facilitator-smoke');

    expect(() =>
      loadFacilitatorSmokeConfig({
        SENTINAI_BASE_URL: 'http://localhost:3002',
      })
    ).toThrow(/TON_FACILITATOR_SMOKE_BUYER_KEY/i);
  });

  it('builds the x402 payment header from the smoke authorization payload', async () => {
    const {
      buildSmokePaymentHeader,
      loadFacilitatorSmokeConfig,
    } = await import('@/lib/marketplace/facilitator-smoke');

    const config = loadFacilitatorSmokeConfig({
      SENTINAI_BASE_URL: 'http://localhost:3002',
      TON_FACILITATOR_SMOKE_BUYER_KEY:
        '0x1111111111111111111111111111111111111111111111111111111111111111',
      TON_FACILITATOR_SMOKE_MERCHANT_ID: 'sequencer-health',
      TON_FACILITATOR_SMOKE_MERCHANT_ADDRESS: '0x4444444444444444444444444444444444444444',
      TON_FACILITATOR_SMOKE_RESOURCE: '/api/marketplace/sequencer-health/',
      TON_FACILITATOR_SMOKE_AMOUNT: '100000000000000000',
      TON_FACILITATOR_INTERNAL_AUTH_SECRET: 'internal-secret',
    });

    const header = buildSmokePaymentHeader({
      network: 'eip155:11155111',
      authorization: {
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        asset: '0xa30fe40285b8f5c0457dbc3b7c8a280373c40044',
        amount: 100000000000000000n,
        resource: config.resource,
        nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        validAfter: 1741680000n,
        validBefore: 1741680300n,
      },
      signature:
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });

    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));

    expect(decoded).toEqual({
      x402Version: 2,
      scheme: 'exact',
      network: 'eip155:11155111',
      payload: {
        authorization: {
          buyer: '0x1111111111111111111111111111111111111111',
          merchant: '0x4444444444444444444444444444444444444444',
          asset: '0xa30fe40285b8f5c0457dbc3b7c8a280373c40044',
          amount: '100000000000000000',
          resource: '/api/marketplace/sequencer-health',
          nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          validAfter: '1741680000',
          validBefore: '1741680300',
        },
        signature:
          '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    });
  });
});
