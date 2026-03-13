import { NextRequest, NextResponse } from 'next/server';
import { handlePaidMarketplaceProduct } from '@/app/api/marketplace/_shared/paid-product-route';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    return await handlePaidMarketplaceProduct(request, 'incident-summary');
  } catch (error) {
    logger.error('[marketplace/incident-summary GET] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to serve incident summary' },
      { status: 500 }
    );
  }
}
