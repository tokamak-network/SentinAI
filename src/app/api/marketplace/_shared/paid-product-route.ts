import { NextRequest, NextResponse } from 'next/server';
import { loadFacilitatorConfig } from '@/lib/marketplace/facilitator/config';
import {
  assertMerchantAllowlistMatchesProduct,
  getResolvedMarketplaceProduct,
} from '@/lib/marketplace/product-registry';
import { buildMarketplacePaymentRequirements } from '@/lib/marketplace/payment-requirements';
import { verifyX402Payment } from '@/lib/marketplace/x402-middleware';

export async function handlePaidMarketplaceProduct(
  request: NextRequest,
  productId: string
): Promise<NextResponse> {
  const config = loadFacilitatorConfig();
  const profile = config.profiles.sepolia;
  const product = getResolvedMarketplaceProduct(productId);

  if (!profile.enabled) {
    return NextResponse.json(
      { error: 'TON facilitator is not enabled for Sepolia' },
      { status: 503 }
    );
  }

  const merchant = config.merchantAllowlist.find((entry) => entry.merchantId === product.merchantId);
  assertMerchantAllowlistMatchesProduct({ product, allowlistEntry: merchant });

  const paymentRequirements = buildMarketplacePaymentRequirements({
    origin: request.nextUrl.origin,
    profile,
    product,
  });

  const paymentHeader = request.headers.get('x-payment');
  if (!paymentHeader) {
    return NextResponse.json(
      {
        error: 'payment_required',
        scheme: 'exact',
        x402Version: 2,
        paymentRequirements,
      },
      { status: 402 }
    );
  }

  try {
    const settlement = await verifyX402Payment(paymentHeader, {
      facilitatorPath: '/api/facilitator/v1/settle',
      merchantId: product.merchantId,
      chainId: profile.chainId,
      asset: product.asset,
      amount: product.amount,
      merchant: product.merchant,
      resource: product.resource,
    });

    return NextResponse.json({
      data: {
        ...product.response,
        settlement: {
          settlementId: settlement.settlementId,
          txHash: settlement.txHash,
          status: settlement.status,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Invalid payment',
        scheme: 'exact',
        x402Version: 2,
        paymentRequirements,
      },
      { status: 402 }
    );
  }
}
