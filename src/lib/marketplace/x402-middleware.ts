import { canonicalizeResource } from '@/lib/marketplace/facilitator/typed-data';
import { settleThroughFacilitator } from '@/lib/marketplace/facilitator-client';

interface X402ServiceConfig {
  facilitatorPath: string;
  merchantId: string;
  chainId: number;
  asset: string;
  amount: string;
  merchant: string;
  resource: string;
}

export async function verifyX402Payment(
  paymentHeader: string,
  service: X402ServiceConfig
) {
  return settleThroughFacilitator({
    facilitatorPath: service.facilitatorPath,
    merchantId: service.merchantId,
    paymentHeader,
    expected: {
      chainId: service.chainId,
      asset: service.asset,
      amount: service.amount,
      merchant: service.merchant,
      resource: canonicalizeResource(service.resource),
    },
  });
}
