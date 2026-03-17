/**
 * Admin Services API
 * GET /api/admin/services — list all x402 marketplace services with current prices
 */

import { NextResponse } from 'next/server';
import { getAgentMarketplaceCatalogWithOverrides } from '@/lib/agent-marketplace/catalog';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const catalog = await getAgentMarketplaceCatalogWithOverrides();
    return NextResponse.json({ success: true, services: catalog.services }, { status: 200 });
  } catch (error) {
    logger.error('[Admin Services API]', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ success: false, error: 'Failed to fetch services' }, { status: 500 });
  }
}
