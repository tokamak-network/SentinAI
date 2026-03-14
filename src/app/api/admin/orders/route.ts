/**
 * Orders API route (GET)
 * - GET: Retrieve paginated marketplace orders
 * - Requires: sentinai_admin_session cookie (validated in middleware)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMarketplaceStore } from '@/lib/marketplace-store';
import logger from '@/lib/logger';

/**
 * GET /api/admin/orders?page=1&limit=20
 * Returns paginated marketplace orders
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const pageStr = searchParams.get('page') || '1';
    const limitStr = searchParams.get('limit') || '20';

    const page = parseInt(pageStr, 10);
    const limit = parseInt(limitStr, 10);

    // Validate pagination params
    if (isNaN(page) || page < 1) {
      return NextResponse.json(
        { success: false, error: 'page must be a positive integer' },
        { status: 400 }
      );
    }

    if (isNaN(limit) || limit < 1 || limit > 100) {
      return NextResponse.json(
        { success: false, error: 'limit must be between 1 and 100' },
        { status: 400 }
      );
    }

    const store = getMarketplaceStore();
    const orders = await store.getOrders(page, limit);
    const summary = await store.getOrdersSummary();

    return NextResponse.json(
      {
        success: true,
        orders,
        summary,
        pagination: {
          page,
          limit,
          total: summary.totalCount,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('[Orders API] Failed to fetch orders:', error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { success: false, error: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS /api/admin/orders
 * CORS preflight
 */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
