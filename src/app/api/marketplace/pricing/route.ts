/**
 * Marketplace Pricing API
 *
 * GET  - Fetch current bracket pricing configuration (public)
 * PUT  - Update bracket pricing (requires SENTINAI_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server';
import type { PricingBracket } from '@/types/marketplace';
import { getMarketplaceStore } from '@/lib/marketplace-store';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/marketplace/pricing
 * Returns current bracket pricing configuration + legacy tier pricing
 */
export async function GET(): Promise<NextResponse> {
  try {
    const store = getMarketplaceStore();
    const [bracketConfig, legacyConfig] = await Promise.all([
      store.getBracketPricingConfig(),
      store.getPricingConfig(),
    ]);

    return NextResponse.json({
      data: bracketConfig,
      legacy: legacyConfig,
    });
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
 * Update bracket pricing configuration (requires API key authentication)
 *
 * Body:
 * {
 *   "brackets": [
 *     { "floor": 80, "priceCents": 79900, "label": "Expert" },
 *     { "floor": 60, "priceCents": 49900, "label": "Advanced" },
 *     { "floor": 30, "priceCents": 19900, "label": "Standard" },
 *     { "floor": 0,  "priceCents": 0,     "label": "Starter" }
 *   ]
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

    const body = await request.json();

    // Validate brackets array
    if (!body.brackets || !Array.isArray(body.brackets)) {
      return NextResponse.json(
        { error: 'brackets must be an array' },
        { status: 400 }
      );
    }

    const brackets: PricingBracket[] = body.brackets;

    // Validate each bracket
    for (const bracket of brackets) {
      if (typeof bracket.floor !== 'number' || bracket.floor < 0 || bracket.floor > 100) {
        return NextResponse.json(
          { error: `Invalid floor value: ${bracket.floor}. Must be 0-100.` },
          { status: 400 }
        );
      }
      if (typeof bracket.priceCents !== 'number' || bracket.priceCents < 0 || !Number.isInteger(bracket.priceCents)) {
        return NextResponse.json(
          { error: `Invalid priceCents for bracket "${bracket.label}": must be a non-negative integer` },
          { status: 400 }
        );
      }
      if (typeof bracket.label !== 'string' || !bracket.label.trim()) {
        return NextResponse.json(
          { error: 'Each bracket must have a non-empty label' },
          { status: 400 }
        );
      }
    }

    // Must have at least one bracket with floor=0
    if (!brackets.some(b => b.floor === 0)) {
      return NextResponse.json(
        { error: 'At least one bracket with floor=0 is required' },
        { status: 400 }
      );
    }

    // Check for duplicate floors
    const floors = brackets.map(b => b.floor);
    if (new Set(floors).size !== floors.length) {
      return NextResponse.json(
        { error: 'Bracket floors must be unique' },
        { status: 400 }
      );
    }

    const store = getMarketplaceStore();
    const updated = await store.updateBracketPricing({
      brackets: [...brackets].sort((a, b) => b.floor - a.floor),
      updatedAt: new Date().toISOString(),
    });

    logger.info('[marketplace/pricing PUT] Bracket pricing updated', {
      bracketCount: updated.brackets.length,
    });

    return NextResponse.json({
      data: updated,
      message: 'Bracket pricing configuration updated',
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
