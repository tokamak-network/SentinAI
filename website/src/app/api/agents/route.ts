import { NextResponse } from 'next/server';
import { getAgentCatalogFromStore } from '@/lib/agent-marketplace';

/**
 * GET /api/agents
 * Returns list of available agents from the marketplace store.
 * This endpoint dynamically loads agents from the store instead of using static catalog.
 */
export async function GET() {
  try {
    const agents = await getAgentCatalogFromStore();
    
    return NextResponse.json({
      agents,
      total: agents.length,
    });
  } catch (error) {
    console.error('[Agents API] GET error:', error);
    // Fallback to static catalog if store fails
    const { getAgentCatalog } = await import('@/lib/agent-marketplace');
    const fallbackAgents = getAgentCatalog();
    
    return NextResponse.json({
      agents: fallbackAgents,
      total: fallbackAgents.length,
    });
  }
}

export const dynamic = 'force-dynamic';
