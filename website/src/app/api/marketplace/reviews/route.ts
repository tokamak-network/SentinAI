import reviewsData from '@/../data/reviews.json';
import type { OperatorReview, ReviewSubmission } from '@/types/review';

const reviews: OperatorReview[] = reviewsData as OperatorReview[];

// Sepolia RPC for on-chain tx verification
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';

/**
 * Verify that a transaction hash exists on-chain and involves the reviewer.
 * Returns { valid, from, to } or throws.
 */
async function verifyOnChainTx(
  txHash: string,
  reviewerAddress: string
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const res = await fetch(SEPOLIA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionByHash',
        params: [txHash],
        id: 1,
      }),
    });

    const data = await res.json();
    const tx = data.result;

    if (!tx) {
      return { valid: false, reason: 'Transaction not found on-chain' };
    }

    // Check that the reviewer is the sender (from) of the transaction
    const txFrom = (tx.from as string).toLowerCase();
    const reviewer = reviewerAddress.toLowerCase();

    if (txFrom !== reviewer) {
      return {
        valid: false,
        reason: `Transaction sender (${txFrom}) does not match reviewer (${reviewer})`,
      };
    }

    return { valid: true };
  } catch (err) {
    // If RPC fails, reject the review (fail-closed)
    return { valid: false, reason: 'Failed to verify transaction on-chain' };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const operator = searchParams.get('operator')?.toLowerCase();

  const filtered = operator
    ? reviews.filter(r => r.operatorAddress.toLowerCase() === operator)
    : reviews;

  return Response.json(filtered);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReviewSubmission;

    if (!body.operatorAddress || !body.reviewerAddress || !body.txHash || !body.ratings) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate tx hash format
    if (!/^0x[a-fA-F0-9]{64}$/.test(body.txHash)) {
      return Response.json({ error: 'Invalid transaction hash format' }, { status: 400 });
    }

    // Validate ratings range
    const { dataAccuracy, responseSpeed, uptime, valueForMoney } = body.ratings;
    if ([dataAccuracy, responseSpeed, uptime, valueForMoney].some(r => r < 1 || r > 5)) {
      return Response.json({ error: 'Ratings must be 1-5' }, { status: 400 });
    }

    // Check duplicate txHash (one review per transaction)
    if (reviews.some(r => r.txHash.toLowerCase() === body.txHash.toLowerCase())) {
      return Response.json({ error: 'Review already submitted for this transaction' }, { status: 409 });
    }

    // On-chain verification: tx must exist and reviewer must be the sender
    const verification = await verifyOnChainTx(body.txHash, body.reviewerAddress);
    if (!verification.valid) {
      return Response.json(
        { error: `On-chain verification failed: ${verification.reason}` },
        { status: 403 }
      );
    }

    const newReview: OperatorReview = {
      id: `r${Date.now()}`,
      operatorAddress: body.operatorAddress.toLowerCase(),
      reviewerAddress: body.reviewerAddress.toLowerCase(),
      serviceKey: body.serviceKey,
      txHash: body.txHash.toLowerCase(),
      ratings: body.ratings,
      comment: body.comment,
      createdAt: new Date().toISOString(),
    };

    // In MVP, push to in-memory array (resets on redeploy)
    reviews.push(newReview);

    return Response.json(newReview, { status: 201 });
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
}
