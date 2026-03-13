import { verifySettlementReceipt } from '@/lib/marketplace/facilitator/receipt-signing';
import { ensureFacilitatorReconcilerStarted } from '@/lib/marketplace/facilitator/reconcile-runner';

interface SettleThroughFacilitatorInput {
  facilitatorPath: string;
  merchantId: string;
  paymentHeader: string;
  expected: {
    chainId: number;
    asset: string;
    amount: string;
    merchant: string;
    resource: string;
  };
}

interface PaymentHeaderPayload {
  network: string;
  payload: {
    authorization: {
      buyer: string;
      merchant: string;
      asset: string;
      amount: string;
      resource: string;
      nonce: string;
      validAfter: number;
      validBefore: number;
    };
    signature: `0x${string}`;
  };
}

export async function settleThroughFacilitator(input: SettleThroughFacilitatorInput) {
  const decoded = JSON.parse(Buffer.from(input.paymentHeader, 'base64').toString('utf8')) as PaymentHeaderPayload;
  const internalSecret = process.env.TON_FACILITATOR_INTERNAL_AUTH_SECRET;
  if (!internalSecret) {
    throw new Error('TON_FACILITATOR_INTERNAL_AUTH_SECRET is required');
  }

  const response = await fetch(input.facilitatorPath, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sentinai-internal-auth': internalSecret,
      'x-sentinai-merchant-id': input.merchantId,
    },
    body: JSON.stringify({
      network: decoded.network,
      authorization: decoded.payload.authorization,
      signature: decoded.payload.signature,
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Facilitator request failed with ${response.status}`);
  }

  const verification = await verifySettlementReceipt(
    {
      success: body.success,
      settlementId: body.settlementId,
      chainId: body.chainId,
      asset: body.asset,
      amount: body.amount,
      buyer: body.buyer,
      merchant: body.merchant,
      resource: body.resource,
      txHash: body.txHash,
      blockNumber: body.blockNumber,
      status: body.status,
    },
    body.signature
  );

  if (!verification.isValid) {
    throw new Error(verification.reason ?? 'Invalid facilitator receipt signature');
  }
  if (body.chainId !== input.expected.chainId) {
    throw new Error('Facilitator receipt chain mismatch');
  }
  if (body.asset !== input.expected.asset) {
    throw new Error('Facilitator receipt asset mismatch');
  }
  if (body.amount !== input.expected.amount) {
    throw new Error('Facilitator receipt amount mismatch');
  }
  if (body.merchant !== input.expected.merchant) {
    throw new Error('Facilitator receipt merchant mismatch');
  }
  if (body.resource !== input.expected.resource) {
    throw new Error('Facilitator receipt resource mismatch');
  }

  await ensureFacilitatorReconcilerStarted();

  return body;
}
