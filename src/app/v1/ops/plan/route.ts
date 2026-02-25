import { NextRequest } from 'next/server';
import { planAutonomousOperation } from '@/lib/autonomous/service';
import { requireAuth, requireRole } from '@/lib/ops-adapter/auth';
import { writeAuditLog } from '@/lib/ops-adapter/audit';
import { createOpsPlan } from '@/lib/ops-adapter/store';
import { mapOpsActionToIntent } from '@/lib/ops-adapter/intent-mapping';
import { jsonError } from '@/lib/ops-adapter/http';

export const dynamic = 'force-dynamic';

function riskToLevel(risks: Array<string | undefined>): 'low' | 'medium' | 'high' {
  const set = new Set(risks.filter(Boolean));
  if (set.has('critical') || set.has('high')) return 'high';
  if (set.has('medium')) return 'medium';
  return 'low';
}

export async function POST(request: NextRequest) {
  let requestId: string | undefined;
  try {
    const actor = requireAuth(request);
    requireRole(actor, 'viewer');

    const body = await request.json();
    requestId = typeof body?.requestId === 'string' ? body.requestId : undefined;

    if (!requestId || requestId.trim().length === 0) {
      return jsonError(400, 'bad_request', 'requestId is required');
    }

    const intent = mapOpsActionToIntent({ action: body?.action, intent: body?.intent });
    if (!intent) {
      return jsonError(400, 'bad_request', 'Unsupported action/intent');
    }

    const dryRun = body?.dryRun !== false;

    const autonomousPlan = planAutonomousOperation({
      intent,
      context: {
        dryRun,
        allowWrites: false,
        metadata: {
          target: body?.target,
          parameters: body?.parameters,
        },
      },
    });

    const stored = createOpsPlan({
      requestId,
      dryRun,
      intent,
      action: typeof body?.action === 'string' ? body.action : undefined,
      target: typeof body?.target === 'object' ? body.target : undefined,
      parameters: typeof body?.parameters === 'object' ? body.parameters : undefined,
    });

    await writeAuditLog({
      at: new Date().toISOString(),
      actor,
      action: 'ops.plan',
      requestId,
      metadata: {
        planId: stored.planId,
        intent,
        dryRun,
      },
    });

    const riskLevel = riskToLevel(autonomousPlan.steps.map((s) => s.risk));

    return Response.json({
      requestId,
      planId: stored.planId,
      status: 'planned',
      riskLevel,
      summary: autonomousPlan.summary,
      proposedChanges: autonomousPlan.steps.map((s) => `${s.action}${s.targetComponent ? ` (${s.targetComponent})` : ''}`),
      dryRun,
      createdAt: stored.createdAt,
      confirmToken: stored.confirmToken,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.toLowerCase().includes('missing bearer token') || message.toLowerCase().includes('invalid bearer token')) {
      return jsonError(401, 'unauthorized', message, requestId);
    }
    if (message.toLowerCase().startsWith('forbidden')) {
      return jsonError(403, 'forbidden', message, requestId);
    }

    return jsonError(500, 'internal_error', message, requestId);
  }
}
