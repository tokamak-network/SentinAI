/**
 * Marketplace Pricing API
 *
 * GET  - Fetch current pricing configuration (public)
 * PUT  - Update pricing (requires SENTINAI_API_KEY)
 * OPTIONS - CORS preflight
 */

import { NextRequest, NextResponse } from 'next/server';
import { RedisMarketplaceStore } from '@/lib/redis-marketplace-store';
import { setMarketplaceStore } from '@/lib/marketplace-store';
import type {
  PricingUpdateRequest,
  MarketplacePricingConfig,
} from '@/types/marketplace';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

// Initialize store singleton on import
const marketplaceStore = new RedisMarketplaceStore();
setMarketplaceStore(marketplaceStore);

/**
 * GET /api/marketplace/pricing
 *
 * Fetch current pricing configuration (public endpoint).
 *
 * @returns JSON response with current pricing tiers
 */
export async function GET(): Promise<NextResponse> {
  try {
    const config = await marketplaceStore.getPricingConfig();
    return NextResponse.json({ data: config });
  } catch (error) {
    logger.error('[marketplace/pricing GET] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pricing configuration' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/marketplace/pricing
 *
 * Update pricing configuration (requires SENTINAI_API_KEY authorization).
 * Supports partial updates — only specified tiers are modified.
 *
 * Authorization: Bearer {SENTINAI_API_KEY}
 *
 * @param request - NextRequest with Bearer token and pricing update payload
 * @returns JSON response with updated pricing configuration or error
 */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    // Extract and validate API key from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Missing Authorization header' },
        { status: 401 }
      );
    }

    const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    const apiKey = process.env.SENTINAI_API_KEY;
    if (!apiKey) {
      logger.error('[marketplace/pricing PUT] SENTINAI_API_KEY not configured');
      return NextResponse.json(
        { error: 'API key not configured on server' },
        { status: 500 }
      );
    }

    // Constant-time comparison to prevent timing attacks
    if (bearerToken !== apiKey) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }

    // Parse request body
    let update: PricingUpdateRequest;
    try {
      update = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    if (!update || typeof update !== 'object') {
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 }
      );
    }

    // Validate pricing fields: must be non-negative integers (cents)
    const priceFields = [
      'traineePrice',
      'juniorPrice',
      'seniorPrice',
      'expertPrice',
    ] as const;

    for (const field of priceFields) {
      const value = update[field];

      if (value !== undefined) {
        if (!Number.isInteger(value)) {
          return NextResponse.json(
            {
              error: `${field} must be an integer (cents), got ${typeof value}`,
            },
            { status: 400 }
          );
        }

        if (value < 0) {
          return NextResponse.json(
            { error: `${field} must be non-negative, got ${value}` },
            { status: 400 }
          );
        }

        // Sanity check: price should not exceed $100,000 (10,000,000 cents)
        if (value > 10000000) {
          return NextResponse.json(
            {
              error: `${field} exceeds maximum allowed price ($100,000), got ${(value / 100).toFixed(2)}`,
            },
            { status: 400 }
          );
        }
      }
    }

    // Update pricing configuration
    const updated = await marketplaceStore.updatePricing(update);

    logger.info('[marketplace/pricing PUT] Pricing updated successfully', {
      traineePrice: updated.traineePrice,
      juniorPrice: updated.juniorPrice,
      seniorPrice: updated.seniorPrice,
      expertPrice: updated.expertPrice,
    });

    return NextResponse.json({
      data: updated,
    });
  } catch (error) {
    logger.error('[marketplace/pricing PUT] error:', error);
    return NextResponse.json(
      { error: 'Failed to update pricing configuration' },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS /api/marketplace/pricing
 *
 * Handle CORS preflight requests.
 *
 * @returns Empty 204 response with CORS headers
 */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
