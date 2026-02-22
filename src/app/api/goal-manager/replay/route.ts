/**
 * Goal Manager DLQ Replay API
 * POST /api/goal-manager/replay
 */

import { NextRequest, NextResponse } from 'next/server';
import { replayGoalManagerDlq } from '@/lib/goal-manager';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const configured = process.env.SENTINAI_API_KEY?.trim();
  if (!configured) return false;
  const provided = request.headers.get('x-api-key')?.trim();
  return !!provided && provided === configured;
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: replay requires admin x-api-key' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const goalId = typeof body?.goalId === 'string' ? body.goalId.trim() : '';
    if (!goalId) {
      return NextResponse.json({ error: 'goalId is required' }, { status: 400 });
    }

    const result = await replayGoalManagerDlq(goalId);
    if (!result.replayed) {
      return NextResponse.json(result, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
