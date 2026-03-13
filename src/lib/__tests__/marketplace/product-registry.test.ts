import { beforeEach, describe, expect, it } from 'vitest';

describe('marketplace product registry', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MARKETPLACE_PRODUCT_SEQUENCER_HEALTH_AMOUNT;
    delete process.env.MARKETPLACE_PRODUCT_SEQUENCER_HEALTH_MERCHANT;
  });

  it('defines sequencer-health as a canonical paid product', async () => {
    const { getMarketplaceProduct } = await import('@/lib/marketplace/product-registry');

    const product = getMarketplaceProduct('sequencer-health');

    expect(product).toEqual({
      productId: 'sequencer-health',
      merchantId: 'sequencer-health',
      resource: '/api/marketplace/sequencer-health',
      network: 'eip155:11155111',
      amount: '100000000000000000',
      merchant: '0x4444444444444444444444444444444444444444',
      asset: '0xa30fe40285B8f5c0457DbC3B7C8A280373c40044',
      response: {
        service: 'sequencer-health',
        network: 'eip155:11155111',
        status: 'healthy',
        latestIncident: null,
      },
    });
  });

  it('allows runtime overrides for amount and merchant while keeping registry identity stable', async () => {
    process.env.MARKETPLACE_PRODUCT_SEQUENCER_HEALTH_AMOUNT = '250000000000000000';
    process.env.MARKETPLACE_PRODUCT_SEQUENCER_HEALTH_MERCHANT = '0x8888888888888888888888888888888888888888';

    const { getResolvedMarketplaceProduct } = await import('@/lib/marketplace/product-registry');

    const product = getResolvedMarketplaceProduct('sequencer-health');

    expect(product).toEqual({
      productId: 'sequencer-health',
      merchantId: 'sequencer-health',
      resource: '/api/marketplace/sequencer-health',
      network: 'eip155:11155111',
      amount: '250000000000000000',
      merchant: '0x8888888888888888888888888888888888888888',
      asset: '0xa30fe40285B8f5c0457DbC3B7C8A280373c40044',
      response: {
        service: 'sequencer-health',
        network: 'eip155:11155111',
        status: 'healthy',
        latestIncident: null,
      },
    });
  });
});
