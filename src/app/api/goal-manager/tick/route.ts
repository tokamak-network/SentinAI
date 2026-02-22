/**
 * Goal Manager Tick API
 * POST /api/goal-manager/tick
 */

import { NextRequest, NextResponse } from 'next/server';
import { tickGoalManager } from '@/lib/goal-manager';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    let now: number | undefined;
    try {
      const body = await request.json();
      if (typeof body?.now === 'number' && Number.isFinite(body.now)) {
        now = body.now;
      }
    } catch {
      // Optional body
    }

    const result = await tickGoalManager(now);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
