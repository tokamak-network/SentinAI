/**
 * Agent Decision Trace API
 * GET /api/agent-decisions
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDecisionTraceEntry, listDecisionTraceEntries } from '@/lib/agent-memory';
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
    const decisionId = searchParams.get('decisionId');

    if (decisionId) {
      const trace = await getDecisionTraceEntry(decisionId);
      if (!trace) {
        return NextResponse.json({ error: 'Decision trace not found' }, { status: 404 });
      }
      return NextResponse.json({ trace });
    }

    const limit = parseLimit(searchParams.get('limit'));
    const severity = (searchParams.get('severity') || undefined) as AISeverity | undefined;
    const fromTs = searchParams.get('fromTs') || undefined;
    const toTs = searchParams.get('toTs') || undefined;

    const traces = await listDecisionTraceEntries({
      limit,
      severity,
      fromTs,
      toTs,
    });

    return NextResponse.json({
      traces,
      total: traces.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API /agent-decisions] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
