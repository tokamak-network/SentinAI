import { getAddress } from 'viem';
import { canonicalizeResource } from '@/lib/marketplace/facilitator/typed-data';
import type { FacilitatorNetwork } from '@/lib/marketplace/facilitator/types';

export interface MarketplaceProductDefinition {
  productId: string;
  merchantId: string;
  resource: string;
  network: FacilitatorNetwork;
  amount: string;
  merchant: `0x${string}`;
  asset: `0x${string}`;
  response: {
    service: string;
    network: FacilitatorNetwork;
    status: string;
    latestIncident: null;
  };
}

function getProductEnvKey(productId: string, suffix: 'AMOUNT' | 'MERCHANT'): string {
  const normalizedProductId = productId.replace(/-/g, '_').toUpperCase();
  return `MARKETPLACE_PRODUCT_${normalizedProductId}_${suffix}`;
}

function resolveMarketplaceProductAmount(product: MarketplaceProductDefinition): string {
  return process.env[getProductEnvKey(product.productId, 'AMOUNT')] ?? product.amount;
}

function resolveMarketplaceProductMerchant(
  product: MarketplaceProductDefinition
): `0x${string}` {
  const override = process.env[getProductEnvKey(product.productId, 'MERCHANT')];
  return override ? getAddress(override) : product.merchant;
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
  'incident-summary': {
    productId: 'incident-summary',
    merchantId: 'incident-summary',
    resource: '/api/marketplace/incident-summary',
    network: 'eip155:11155111',
    amount: '150000000000000000',
    merchant: '0x5555555555555555555555555555555555555555',
    asset: '0xa30fe40285B8f5c0457DbC3B7C8A280373c40044',
    response: {
      service: 'incident-summary',
      network: 'eip155:11155111',
      status: 'stable',
      latestIncident: null,
    },
  },
  'batch-submission-status': {
    productId: 'batch-submission-status',
    merchantId: 'batch-submission-status',
    resource: '/api/marketplace/batch-submission-status',
    network: 'eip155:11155111',
    amount: '150000000000000000',
    merchant: '0x6666666666666666666666666666666666666666',
    asset: '0xa30fe40285B8f5c0457DbC3B7C8A280373c40044',
    response: {
      service: 'batch-submission-status',
      network: 'eip155:11155111',
      status: 'healthy',
      latestIncident: null,
    },
  },
};

export function getMarketplaceProduct(productId: string): MarketplaceProductDefinition {
  const product = PRODUCTS[productId];
  if (!product) {
    throw new Error(`Unknown marketplace product: ${productId}`);
  }
  return product;
}

export function getResolvedMarketplaceProduct(productId: string): MarketplaceProductDefinition {
  const product = getMarketplaceProduct(productId);
  return {
    ...product,
    amount: resolveMarketplaceProductAmount(product),
    merchant: resolveMarketplaceProductMerchant(product),
  };
}

export function assertMerchantAllowlistMatchesProduct(input: {
  product: MarketplaceProductDefinition;
  allowlistEntry?: {
    merchantId: string;
    address: `0x${string}`;
    resources: string[];
    networks: FacilitatorNetwork[];
  };
}): void {
  if (!input.allowlistEntry) {
    throw new Error(`Registry mismatch: missing merchant allowlist entry for ${input.product.merchantId}`);
  }

  if (input.allowlistEntry.merchantId !== input.product.merchantId) {
    throw new Error(`Registry mismatch: merchant id does not match product ${input.product.productId}`);
  }
  if (getAddress(input.allowlistEntry.address) !== getAddress(input.product.merchant)) {
    throw new Error(`Registry mismatch: merchant address does not match product ${input.product.productId}`);
  }
  if (!input.allowlistEntry.networks.includes(input.product.network)) {
    throw new Error(`Registry mismatch: merchant network does not match product ${input.product.productId}`);
  }
  if (!input.allowlistEntry.resources.includes(canonicalizeResource(input.product.resource))) {
    throw new Error(`Registry mismatch: merchant resource does not match product ${input.product.productId}`);
  }
}
