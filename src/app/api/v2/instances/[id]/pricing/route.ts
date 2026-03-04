/**
 * v2 Instance Pricing Endpoint
 * GET -> Agent pricing calculation (tier + outcome bonuses)
 *
 * Returns the current pricing tier, monthly rate, and performance-based
 * outcome bonuses for the Agent-for-Hire revenue model.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import { calculatePricing } from '@/lib/pricing-engine';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;

  try {
    const instance = await getInstance(id);
    if (!instance) {
      return NextResponse.json(
        { error: 'Instance not found.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const pricing = await calculatePricing(id, instance.protocolId);

    return NextResponse.json({
      data: pricing,
      meta: meta(),
    });
  } catch (error) {
    logger.error(`[v2 GET /instances/${id}/pricing] error:`, error);
    return NextResponse.json(
      { error: 'Failed to calculate pricing.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
