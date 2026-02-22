/**
 * Goal Manager Dispatch API
 * POST /api/goal-manager/dispatch
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatchTopGoal } from '@/lib/goal-manager';

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
        { error: 'Unauthorized: dispatch requires admin x-api-key' },
        { status: 401 }
      );
    }

    let dryRun: boolean | undefined;
    let allowWrites: boolean | undefined;
    let now: number | undefined;
    try {
      const body = await request.json();
      if (typeof body?.dryRun === 'boolean') dryRun = body.dryRun;
      if (typeof body?.allowWrites === 'boolean') allowWrites = body.allowWrites;
      if (typeof body?.now === 'number' && Number.isFinite(body.now)) now = body.now;
    } catch {
      // Optional body
    }

    const result = await dispatchTopGoal({
      now,
      dryRun,
      allowWrites,
      initiatedBy: 'api',
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
