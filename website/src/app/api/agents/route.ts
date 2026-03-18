import { NextResponse } from 'next/server';
import { getServiceCatalog } from '@/lib/agent-marketplace';

/**
 * GET /api/agents
 * Returns the agent marketplace service catalog.
 */
export async function GET() {
  const catalog = getServiceCatalog();

  return NextResponse.json(catalog);
}

export const dynamic = 'force-dynamic';
