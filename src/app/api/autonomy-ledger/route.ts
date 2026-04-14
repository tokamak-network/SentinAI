/**
 * Autonomy Ledger API
 * GET /api/autonomy-ledger
 *
 * Query params:
 *   since   ISO 8601 timestamp — return entries at or after this time
 *   until   ISO 8601 timestamp — return entries before this time
 *   kind    LedgerEntryKind filter
 *   agent   agent name filter
 *   limit   max results (default 100, max 500)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLedger } from '@/core/autonomy-ledger';
import type { LedgerEntryKind, LedgerQuery } from '@/types/autonomy-ledger';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

const VALID_KINDS = new Set<LedgerEntryKind>([
  'decision_taken',
  'action_executed',
  'action_suppressed',
  'fallback_triggered',
  'guardrail_blocked',
]);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const q: LedgerQuery = {};

    const since = searchParams.get('since');
    if (since) {
      if (Number.isNaN(new Date(since).getTime())) {
        return NextResponse.json({ error: 'Invalid since parameter' }, { status: 400 });
      }
      q.since = since;
    }

    const until = searchParams.get('until');
    if (until) {
      if (Number.isNaN(new Date(until).getTime())) {
        return NextResponse.json({ error: 'Invalid until parameter' }, { status: 400 });
      }
      q.until = until;
    }

    const kind = searchParams.get('kind');
    if (kind) {
      if (!VALID_KINDS.has(kind as LedgerEntryKind)) {
        return NextResponse.json({ error: `Invalid kind: ${kind}` }, { status: 400 });
      }
      q.kind = kind as LedgerEntryKind;
    }

    const agent = searchParams.get('agent');
    if (agent) q.agent = agent;

    const limitRaw = searchParams.get('limit');
    if (limitRaw) {
      const parsed = Number.parseInt(limitRaw, 10);
      if (!Number.isNaN(parsed)) q.limit = parsed;
    }

    const entries = await getLedger().query(q);
    return NextResponse.json({ entries, total: entries.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[API /autonomy-ledger] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
