/**
 * Marketplace Product Registry (website stub)
 * Full implementation lives in the main SentinAI app.
 */

export interface MarketplaceProductDefinition {
  productId: string;
  merchantId: string;
  resource: string;
  network: string;
  amount: string;
  merchant: `0x${string}`;
  asset: `0x${string}`;
  response: {
    service: string;
    network: string;
    status: string;
    latestIncident: null;
  };
}

const PRODUCTS: Record<string, MarketplaceProductDefinition> = {
  'sequencer-health': {
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
  },
};

export function getResolvedMarketplaceProduct(productId: string): MarketplaceProductDefinition {
  const product = PRODUCTS[productId];
  if (!product) {
    throw new Error(`Unknown marketplace product: ${productId}`);
  }
  return product;
}
