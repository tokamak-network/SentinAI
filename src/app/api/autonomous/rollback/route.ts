import { NextRequest, NextResponse } from 'next/server';
import { rollbackAutonomousOperation } from '@/lib/autonomous/service';

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
      return NextResponse.json({ error: 'Unauthorized: rollback requires admin x-api-key' }, { status: 401 });
    }

    const body = await request.json();
    if (typeof body?.operationId !== 'string' || body.operationId.trim().length === 0) {
      return NextResponse.json({ error: 'operationId is required' }, { status: 400 });
    }

    const result = await rollbackAutonomousOperation({
      operationId: body.operationId,
      dryRun: body?.dryRun !== false,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
