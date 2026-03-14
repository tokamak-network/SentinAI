import { NextResponse } from 'next/server';
import { getAgentCatalog } from '@/lib/agent-marketplace';

/**
 * GET /api/agents
 * Returns list of available agents from the marketplace.
 */
export async function GET() {
  const agents = getAgentCatalog();

  return NextResponse.json({
    agents,
    total: agents.length,
  });
}

export const dynamic = 'force-dynamic';
