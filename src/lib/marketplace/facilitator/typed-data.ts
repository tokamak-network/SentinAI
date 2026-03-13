import { getAddress } from 'viem';
import type { FacilitatorProfile, PaymentAuthorization } from '@/lib/marketplace/facilitator/types';

const PAYMENT_AUTHORIZATION_TYPES = {
  PaymentAuthorization: [
    { name: 'buyer', type: 'address' },
    { name: 'merchant', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'resource', type: 'string' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
  ],
} as const;

export function getPaymentAuthorizationDomain(
  profile: Pick<FacilitatorProfile, 'chainId' | 'facilitatorAddress'>
) {
  return {
    name: 'SentinAI x402 TON Facilitator',
    version: '1',
    chainId: profile.chainId,
    verifyingContract: getAddress(profile.facilitatorAddress),
  } as const;
}

export function getPaymentAuthorizationTypes() {
  return PAYMENT_AUTHORIZATION_TYPES;
}

export function canonicalizeResource(resource: string): string {
  const trimmed = resource.trim();

  if (/^[a-z]+:\/\//i.test(trimmed)) {
    throw new Error('Resource must not contain an origin');
  }
  if (!trimmed.startsWith('/')) {
    throw new Error('Resource must be a path-only value');
  }
  if (trimmed.includes('?')) {
    throw new Error('Resource must not include a query string');
  }
  if (trimmed.includes('#')) {
    throw new Error('Resource must not include a fragment');
  }
  if (trimmed.slice(1).includes('//')) {
    throw new Error('Resource must not include duplicate slashes');
  }

  const canonical = trimmed.length > 1 && trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  if (!canonical.startsWith('/api/marketplace/')) {
    throw new Error('Resource must target /api/marketplace/*');
  }

  return canonical;
}

export function canonicalizeAuthorization(
  authorization: PaymentAuthorization
): PaymentAuthorization {
  return {
    ...authorization,
    buyer: getAddress(authorization.buyer),
    merchant: getAddress(authorization.merchant),
    asset: getAddress(authorization.asset),
    resource: canonicalizeResource(authorization.resource),
  };
}
