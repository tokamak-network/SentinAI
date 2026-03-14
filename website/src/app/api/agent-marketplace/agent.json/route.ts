import { NextRequest, NextResponse } from 'next/server';
import { getManifestCatalog } from '@/lib/agent-marketplace';

/**
 * GET /api/agent-marketplace/agent.json
 * Returns agent manifests for registry/discovery
 * Public endpoint - no authentication required
 */
export async function GET(_request: NextRequest) {
  try {
    const manifests = getManifestCatalog();
    return NextResponse.json(manifests, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // 5 minute cache
      },
    });
  } catch (error) {
    console.error('[Marketplace API] Agent manifest error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agent manifests' },
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
