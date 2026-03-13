import { getAddress } from 'viem';
import { getPaymentAuthorizationDomain, getPaymentAuthorizationTypes } from '@/lib/marketplace/facilitator/typed-data';
import type { MarketplaceProductDefinition } from '@/lib/marketplace/product-registry';
import type { FacilitatorProfile } from '@/lib/marketplace/facilitator/types';

export interface MarketplacePaymentRequirementsInput {
  origin: string;
  profile: Pick<FacilitatorProfile, 'chainId' | 'network' | 'facilitatorAddress' | 'tonAssetAddress'>;
  product: Pick<MarketplaceProductDefinition, 'merchant' | 'amount' | 'resource'>;
}

export function buildMarketplacePaymentRequirements(input: MarketplacePaymentRequirementsInput) {
  return {
    network: input.profile.network,
    asset: getAddress(input.profile.tonAssetAddress),
    amount: input.product.amount,
    resource: input.product.resource,
    merchant: getAddress(input.product.merchant),
    facilitator: {
      mode: 'same-app',
      settleUrl: `${input.origin}/api/facilitator/v1/settle`,
      receiptUrl: `${input.origin}/api/facilitator/v1/settlements/{settlementId}`,
      spender: getAddress(input.profile.facilitatorAddress),
    },
    authorization: {
      type: 'eip712',
      domain: getPaymentAuthorizationDomain(input.profile),
      primaryType: 'PaymentAuthorization',
      types: getPaymentAuthorizationTypes(),
    },
    receipt: {
      type: 'detached-signature',
      fields: [
        'success',
        'settlementId',
        'chainId',
        'asset',
        'amount',
        'buyer',
        'merchant',
        'resource',
        'txHash',
        'blockNumber',
        'status',
      ],
    },
  } as const;
}
