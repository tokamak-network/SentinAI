import reviewsData from '@/../data/reviews.json';
import type { OperatorReview } from '@/types/review';
import { calculateGuardianScore } from '@/lib/guardian-score';

const reviews: OperatorReview[] = reviewsData as OperatorReview[];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const operatorReviews = reviews.filter(
    r => r.operatorAddress.toLowerCase() === address.toLowerCase()
  );

  const score = calculateGuardianScore(operatorReviews);

  return Response.json({
    operatorAddress: address.toLowerCase(),
    ...score,
  });
}
