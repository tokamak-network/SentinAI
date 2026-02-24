import { NextRequest, NextResponse } from 'next/server';
import { planAutonomousOperation } from '@/lib/autonomous/service';
import type { AutonomousIntent } from '@/types/autonomous-ops';

export const dynamic = 'force-dynamic';

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
    if (!isIntent(body?.intent)) {
      return NextResponse.json({ error: 'Invalid intent' }, { status: 400 });
    }

    const plan = planAutonomousOperation({
      intent: body.intent,
      context: {
        chainType: typeof body?.chainType === 'string' ? body.chainType : undefined,
        runtime: body?.runtime === 'docker' ? 'docker' : 'k8s',
        dryRun: body?.dryRun !== false,
        allowWrites: body?.allowWrites === true,
        confidence: typeof body?.confidence === 'number' ? body.confidence : undefined,
      },
    });

    return NextResponse.json({ success: true, plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
