import { NextRequest, NextResponse } from 'next/server';
import { getServiceCatalog } from '@/lib/agent-marketplace';

/**
 * GET /api/agent-marketplace/catalog
 * Returns the agent marketplace service catalog (AgentMarketplaceCatalog format)
 * Public endpoint - no authentication required
 */
export async function GET(_request: NextRequest) {
  try {
    const catalog = getServiceCatalog();
    return NextResponse.json(catalog, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // 5 minute cache
      },
    });
  } catch (error) {
    console.error('[Marketplace API] Catalog error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch catalog' },
      { status: 500 }
    );
  }
}

export async function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
