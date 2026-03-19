import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAddress } from 'viem';
import { loadFacilitatorConfig } from '@/lib/marketplace/facilitator/config';
import { verifyPaymentAuthorization } from '@/lib/marketplace/facilitator/verify-authorization';
import { consumeNonce } from '@/lib/marketplace/facilitator/nonce-store';
import { checkFunds } from '@/lib/marketplace/facilitator/check-funds';
import { settleTransfer } from '@/lib/marketplace/facilitator/settle-transfer';
import { signSettlementReceipt } from '@/lib/marketplace/facilitator/receipt-signing';
import { createSettlement } from '@/lib/marketplace/facilitator/settlement-store';
import { ensureFacilitatorReconcilerStarted } from '@/lib/marketplace/facilitator/reconcile-runner';
import { canonicalizeResource } from '@/lib/marketplace/facilitator/typed-data';
import type { FacilitatorNetwork, PaymentAuthorization, SettlementReceiptPayload } from '@/lib/marketplace/facilitator/types';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

function unauthorized(message: string, status = 401) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const config = loadFacilitatorConfig();
    const internalAuth = request.headers.get('x-sentinai-internal-auth');
    if (!internalAuth || internalAuth !== config.internalAuthSecret) {
      return unauthorized('Unauthorized facilitator request');
    }

    const merchantId = request.headers.get('x-sentinai-merchant-id');
    if (!merchantId) {
      return unauthorized('Missing merchant id', 403);
    }

    const allowlistedMerchant = config.merchantAllowlist.find((entry) => entry.merchantId === merchantId);
    if (!allowlistedMerchant) {
      return unauthorized('Merchant is not allowlisted', 403);
    }

    const body = (await request.json()) as {
      network: FacilitatorNetwork;
      authorization: Omit<PaymentAuthorization, 'amount' | 'validAfter' | 'validBefore'> & {
        amount: string;
        validAfter: string;
        validBefore: string;
      };
      signature: `0x${string}`;
    };

    const profile = Object.values(config.profiles).find((candidate) => candidate.network === body.network && candidate.enabled);
    if (!profile) {
      return NextResponse.json({ error: `Unsupported network ${body.network}` }, { status: 400 });
    }
    if (!allowlistedMerchant.networks.includes(body.network)) {
      return unauthorized('Merchant is not allowed on this network', 403);
    }
    if (getAddress(allowlistedMerchant.address) !== getAddress(profile.facilitatorAddress)) {
      return unauthorized('Merchant must equal facilitator spender for this network', 403);
    }

    const authorization: PaymentAuthorization = {
      ...body.authorization,
      buyer: getAddress(body.authorization.buyer),
      merchant: getAddress(body.authorization.merchant),
      asset: getAddress(body.authorization.asset),
      amount: BigInt(body.authorization.amount),
      resource: canonicalizeResource(body.authorization.resource),
      validAfter: BigInt(body.authorization.validAfter),
      validBefore: BigInt(body.authorization.validBefore),
    };

    if (authorization.merchant !== getAddress(allowlistedMerchant.address)) {
      return unauthorized('Merchant address is not allowlisted', 403);
    }
    if (!allowlistedMerchant.resources.includes(authorization.resource)) {
      return unauthorized('Resource is not allowlisted for merchant', 403);
    }

    const verification = await verifyPaymentAuthorization({
      profile,
      network: body.network,
      authorization,
      signature: body.signature,
      expected: {
        merchant: authorization.merchant,
        asset: profile.tonAssetAddress,
        amount: authorization.amount,
        resource: authorization.resource,
      },
      now: BigInt(Math.floor(Date.now() / 1000)),
    });
    if (!verification.isValid) {
      return NextResponse.json({ error: verification.reason ?? 'Invalid payment authorization' }, { status: 400 });
    }

    try {
      await consumeNonce({
        redisPrefix: config.redisPrefix,
        chainId: profile.chainId,
        buyer: authorization.buyer,
        nonce: authorization.nonce,
        validBefore: authorization.validBefore,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Nonce replay detected' },
        { status: 409 }
      );
    }

    try {
      await checkFunds({
        profile,
        buyer: authorization.buyer,
        facilitatorSpender: profile.facilitatorAddress,
        amount: authorization.amount,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Funding check failed' },
        { status: 402 }
      );
    }

    const settlement = await settleTransfer({
      profile,
      buyer: authorization.buyer,
      merchant: authorization.merchant,
      expectedMerchant: allowlistedMerchant.address,
      amount: authorization.amount,
      resource: authorization.resource,
      nonce: authorization.nonce,
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      signature: body.signature,
    });

    const settlementId = randomUUID();
    const receiptPayload: SettlementReceiptPayload = {
      success: true,
      settlementId,
      chainId: profile.chainId,
      asset: profile.tonAssetAddress,
      amount: authorization.amount.toString(),
      buyer: authorization.buyer,
      merchant: authorization.merchant,
      resource: authorization.resource,
      txHash: settlement.txHash,
      blockNumber: null,
      status: settlement.status,
    };
    const signedReceipt = await signSettlementReceipt(receiptPayload, config.receiptSigningKey);

    await createSettlement(config.redisPrefix, {
      settlementId,
      chainId: profile.chainId,
      network: profile.network,
      merchantId,
      asset: profile.tonAssetAddress,
      buyer: authorization.buyer,
      merchant: authorization.merchant,
      amount: authorization.amount.toString(),
      resource: authorization.resource,
      nonce: authorization.nonce,
      txHash: settlement.txHash,
      status: settlement.status,
      txStatus: settlement.status,
      receiptSignature: signedReceipt.signature,
      confirmedBlock: null,
      transferVerified: false,
      failureReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await ensureFacilitatorReconcilerStarted();

    return NextResponse.json({
      ...signedReceipt.payload,
      signature: signedReceipt.signature,
      signer: signedReceipt.signer,
    });
  } catch (error) {
    logger.error('[facilitator/settle POST] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to settle payment' },
      { status: 500 }
    );
  }
}
