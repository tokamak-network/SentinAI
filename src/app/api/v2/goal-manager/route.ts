/**
 * v2 Goal Manager Status API
 * GET /api/v2/goal-manager
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGoalManagerConfig, listGoalManagerState } from '@/lib/goal-manager';

export const dynamic = 'force-dynamic';

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || '50', 10);
  if (Number.isNaN(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 500);
}

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

function buildSummary(state: Awaited<ReturnType<typeof listGoalManagerState>>) {
  const statusCounts: Record<string, number> = {};
  for (const item of state.queue) {
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  }

  const suppressionReasonCounts: Record<string, number> = {};
  for (const record of state.suppression) {
    suppressionReasonCounts[record.reasonCode] = (suppressionReasonCounts[record.reasonCode] || 0) + 1;
  }

  const queueDepth = state.queue.filter((item) => (
    item.status === 'queued' || item.status === 'scheduled' || item.status === 'running'
  )).length;

  return {
    queueDepth,
    queueTotal: state.queue.length,
    candidateTotal: state.candidates.length,
    dlqTotal: state.dlq.length,
    suppressionTotal: state.suppression.length,
    statusCounts,
    suppressionReasonCounts,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseLimit(searchParams.get('limit'));
    const [config, state] = await Promise.all([
      Promise.resolve(getGoalManagerConfig()),
      listGoalManagerState(limit),
    ]);

    const summary = buildSummary(state);

    return NextResponse.json({
      data: {
        config,
        activeGoalId: state.activeGoalId,
        queueDepth: summary.queueDepth,
        summary,
        queue: state.queue,
        dlq: state.dlq,
        candidates: state.candidates,
        suppression: state.suppression,
        lastTickSuppressedCount: state.lastTickSuppressedCount,
      },
      meta: meta(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
