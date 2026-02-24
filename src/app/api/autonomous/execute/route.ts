import { NextRequest, NextResponse } from 'next/server';
import { executeAutonomousOperation } from '@/lib/autonomous/service';
import type { AutonomousIntent } from '@/types/autonomous-ops';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const configured = process.env.SENTINAI_API_KEY?.trim();
  if (!configured) return false;
  const provided = request.headers.get('x-api-key')?.trim();
  return !!provided && provided === configured;
}

function isIntent(value: unknown): value is AutonomousIntent {
  return value === 'stabilize_throughput' ||
    value === 'recover_sequencer_path' ||
    value === 'reduce_cost_idle_window' ||
    value === 'restore_l1_connectivity' ||
    value === 'protect_critical_eoa';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const dryRun = body?.dryRun !== false;
    const allowWrites = body?.allowWrites === true;

    if (!dryRun && allowWrites && !isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized: write execution requires admin x-api-key' }, { status: 401 });
    }

    const intent = isIntent(body?.intent) ? body.intent : undefined;
    const planId = typeof body?.planId === 'string' ? body.planId : undefined;

    const result = await executeAutonomousOperation({
      planId,
      intent,
      context: {
        chainType: typeof body?.chainType === 'string' ? body.chainType : undefined,
        runtime: body?.runtime === 'docker' ? 'docker' : 'k8s',
        dryRun,
        allowWrites,
        confidence: typeof body?.confidence === 'number' ? body.confidence : undefined,
      },
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
