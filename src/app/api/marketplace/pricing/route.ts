/**
 * Marketplace Pricing API
 *
 * GET  - Fetch current pricing configuration (public)
 * PUT  - Update pricing (requires SENTINAI_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server';
import type { MarketplacePricingConfig, PricingUpdateRequest } from '@/types/marketplace';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

// Default pricing configuration
const DEFAULT_PRICING: MarketplacePricingConfig = {
  traineePrice: 0,
  juniorPrice: 19900,   // $199
  seniorPrice: 49900,   // $499
  expertPrice: 79900,   // $799
  updatedAt: new Date().toISOString(),
};

// In-memory store (replace with Redis in production)
let pricingConfig = DEFAULT_PRICING;

/**
 * GET /api/marketplace/pricing
 * Returns current pricing configuration
 */
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ data: pricingConfig });
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
 * Update pricing configuration (requires API key authentication)
 *
 * Body:
 * {
 *   "traineePrice": 0,      // optional, in cents
 *   "juniorPrice": 19900,   // optional, in cents
 *   "seniorPrice": 49900,   // optional, in cents
 *   "expertPrice": 79900    // optional, in cents
 * }
 */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    // Check API key
    const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
    const expectedKey = process.env.SENTINAI_API_KEY;

    if (!expectedKey || !apiKey || apiKey !== expectedKey) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing API key' },
        { status: 401 }
      );
    }

    const body: PricingUpdateRequest = await request.json();

    // Validate: all prices must be non-negative integers
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && (typeof value !== 'number' || value < 0 || !Number.isInteger(value))) {
        return NextResponse.json(
          { error: `Invalid ${key}: must be a non-negative integer (cents)` },
          { status: 400 }
        );
      }
    }

    // Update pricing
    pricingConfig = {
      ...pricingConfig,
      ...body,
      updatedAt: new Date().toISOString(),
    };

    logger.info('[marketplace/pricing PUT] Pricing updated successfully', body);

    return NextResponse.json({
      data: pricingConfig,
      message: 'Pricing configuration updated',
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
 * CORS preflight
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
