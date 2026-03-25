import type { OperatorReview } from '@/types/review';
import { calculateGuardianScore } from '@/lib/guardian-score';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  // Fetch reviews from on-chain + legacy API
  const baseUrl = new URL(request.url).origin;
  let reviews: OperatorReview[] = [];

  try {
    const res = await fetch(`${baseUrl}/api/marketplace/reviews-onchain?operator=${address}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (res.ok) {
      const data = await res.json();
      // Normalize to OperatorReview format
      reviews = data.map((r: any) => ({
        id: r.id,
        operatorAddress: r.operator ?? r.operatorAddress,
        reviewerAddress: r.reviewer ?? r.reviewerAddress,
        serviceKey: r.serviceKey ?? '',
        txHash: r.txHash ?? '',
        ratings: r.ratings ?? {
          dataAccuracy: r.dataAccuracy ?? 3,
          responseSpeed: r.responseSpeed ?? 3,
          uptime: r.uptime ?? 3,
          valueForMoney: r.valueForMoney ?? 3,
        },
        comment: r.comment,
        createdAt: r.createdAt ?? new Date().toISOString(),
      }));
    }
  } catch {
    // Fallback to legacy
    try {
      const res = await fetch(`${baseUrl}/api/marketplace/reviews?operator=${address}`);
      if (res.ok) reviews = await res.json();
    } catch { /* empty */ }
  }

  const score = calculateGuardianScore(reviews);

  return Response.json({
    operatorAddress: address.toLowerCase(),
    ...score,
  });
}
