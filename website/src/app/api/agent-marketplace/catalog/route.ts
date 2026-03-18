import { NextRequest, NextResponse } from 'next/server';
import { getServiceCatalog } from '@/lib/agent-marketplace';

/**
 * GET /api/agent-marketplace/catalog
 * Returns the agent marketplace service catalog (AgentMarketplaceCatalog format)
 * Enriches agent metadata with on-chain operator address from operator-info endpoint.
 * Public endpoint - no authentication required
 */
export async function GET(_request: NextRequest) {
  try {
    const catalog = getServiceCatalog();

    // Fetch on-chain operator address: env var → operator-info API → fallback
    let operatorAddress: string | undefined = process.env.OPERATOR_ADDRESS || undefined;
    if (!operatorAddress) {
      const operatorApiUrl = process.env.NEXT_PUBLIC_OPERATOR_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3002';
      try {
        const res = await fetch(`${operatorApiUrl}/api/agent-marketplace/ops/operator-info`, {
          next: { revalidate: 60 },
        });
        if (res.ok) {
          const info = await res.json() as { address: string | null };
          if (info.address) operatorAddress = info.address;
        }
      } catch {
        // Non-fatal: fall back to static operator name
      }
    }

    const enriched = operatorAddress
      ? { ...catalog, agent: { ...catalog.agent, operatorAddress } }
      : catalog;

    return NextResponse.json(enriched, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
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
