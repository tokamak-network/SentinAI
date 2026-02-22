/**
 * Goal Manager Status API
 * GET /api/goal-manager
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGoalManagerConfig, listGoalManagerState } from '@/lib/goal-manager';

export const dynamic = 'force-dynamic';

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || '50', 10);
  if (Number.isNaN(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 500);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseLimit(searchParams.get('limit'));
    const [config, state] = await Promise.all([
      Promise.resolve(getGoalManagerConfig()),
      listGoalManagerState(limit),
    ]);

    const queueDepth = state.queue.filter((item) => (
      item.status === 'queued' || item.status === 'scheduled' || item.status === 'running'
    )).length;

    return NextResponse.json({
      config,
      activeGoalId: state.activeGoalId,
      queueDepth,
      queue: state.queue,
      dlq: state.dlq,
      candidates: state.candidates,
      suppression: state.suppression,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
