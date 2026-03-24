import reviewsData from '@/../data/reviews.json';
import type { OperatorReview, ReviewSubmission } from '@/types/review';

const reviews: OperatorReview[] = reviewsData as OperatorReview[];

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

    // Validate ratings range
    const { dataAccuracy, responseSpeed, uptime, valueForMoney } = body.ratings;
    if ([dataAccuracy, responseSpeed, uptime, valueForMoney].some(r => r < 1 || r > 5)) {
      return Response.json({ error: 'Ratings must be 1-5' }, { status: 400 });
    }

    // Check duplicate txHash
    if (reviews.some(r => r.txHash === body.txHash)) {
      return Response.json({ error: 'Review already submitted for this transaction' }, { status: 409 });
    }

    const newReview: OperatorReview = {
      id: `r${Date.now()}`,
      operatorAddress: body.operatorAddress.toLowerCase(),
      reviewerAddress: body.reviewerAddress.toLowerCase(),
      serviceKey: body.serviceKey,
      txHash: body.txHash,
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
