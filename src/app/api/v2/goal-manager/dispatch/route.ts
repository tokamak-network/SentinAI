/**
 * v2 Goal Manager Dispatch API
 * POST /api/v2/goal-manager/dispatch
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

function isReadOnlyMode(): boolean {
  return process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true';
}

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: dispatch requires admin x-api-key', code: 'UNAUTHORIZED' },
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

    const effectiveDryRun = dryRun !== false;
    const effectiveAllowWrites = allowWrites === true;
    if (isReadOnlyMode() && (!effectiveDryRun || effectiveAllowWrites)) {
      return NextResponse.json(
        { error: 'Write operations are disabled in read-only mode', code: 'READ_ONLY_MODE' },
        { status: 403 }
      );
    }

    const result = await dispatchTopGoal({
      now,
      dryRun,
      allowWrites,
      initiatedBy: 'api',
    });

    return NextResponse.json({ data: result, meta: meta() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
