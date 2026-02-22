/**
 * Agent Memory API
 * GET /api/agent-memory
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryAgentMemory } from '@/lib/agent-memory';
import type { AgentMemoryCategory } from '@/types/agent-memory';
import type { AISeverity } from '@/types/scaling';

export const dynamic = 'force-dynamic';

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value || '50', 10);
  if (Number.isNaN(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 500);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseLimit(searchParams.get('limit'));
    const category = (searchParams.get('category') || undefined) as AgentMemoryCategory | undefined;
    const component = searchParams.get('component') || undefined;
    const severity = (searchParams.get('severity') || undefined) as AISeverity | undefined;
    const decisionId = searchParams.get('decisionId') || undefined;
    const fromTs = searchParams.get('fromTs') || undefined;
    const toTs = searchParams.get('toTs') || undefined;

    const entries = await queryAgentMemory({
      limit,
      category,
      component,
      severity,
      decisionId,
      fromTs,
      toTs,
    });

    return NextResponse.json({
      entries,
      total: entries.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API /agent-memory] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
