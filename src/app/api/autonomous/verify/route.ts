import { NextRequest, NextResponse } from 'next/server';
import { verifyAutonomousOperation } from '@/lib/autonomous/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body?.operationId !== 'string' || body.operationId.trim().length === 0) {
      return NextResponse.json({ error: 'operationId is required' }, { status: 400 });
    }

    const result = await verifyAutonomousOperation({
      operationId: body.operationId,
      before: typeof body?.before === 'object' ? body.before : undefined,
      after: typeof body?.after === 'object' ? body.after : undefined,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
