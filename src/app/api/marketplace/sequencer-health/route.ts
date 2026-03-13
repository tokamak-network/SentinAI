import { NextRequest, NextResponse } from 'next/server';
import { handlePaidMarketplaceProduct } from '@/app/api/marketplace/_shared/paid-product-route';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    return await handlePaidMarketplaceProduct(request, 'sequencer-health');
  } catch (error) {
    logger.error('[marketplace/sequencer-health GET] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to serve sequencer health' },
      { status: 500 }
    );
  }
}
