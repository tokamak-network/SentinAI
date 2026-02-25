import { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/lib/ops-adapter/auth';
import { writeAuditLog } from '@/lib/ops-adapter/audit';
import { requireOpsPlan, createOpsJob } from '@/lib/ops-adapter/store';
import { jsonError } from '@/lib/ops-adapter/http';
import { enqueueOpsJob } from '@/lib/ops-adapter/worker';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let requestId: string | undefined;
  try {
    const actor = requireAuth(request);
    requireRole(actor, 'operator');

    const body = await request.json();
    requestId = typeof body?.requestId === 'string' ? body.requestId : undefined;

    if (!requestId || requestId.trim().length === 0) {
      return jsonError(400, 'bad_request', 'requestId is required');
    }

    const planId = typeof body?.planId === 'string' ? body.planId : undefined;
    if (!planId || planId.trim().length === 0) {
      return jsonError(400, 'bad_request', 'planId is required', requestId);
    }

    // Ensure the plan exists.
    const plan = requireOpsPlan(planId);

    const job = createOpsJob({
      type: 'verify',
      requestId,
      planId,
      dryRun: plan.dryRun,
      summary: `verify planId=${planId}`,
    });

    enqueueOpsJob({
      jobId: job.jobId,
      type: 'verify',
      actor,
      requestId,
      payload: { planId, requestId },
    });

    await writeAuditLog({
      at: new Date().toISOString(),
      actor,
      action: 'ops.verify.queued',
      requestId,
      metadata: { planId, jobId: job.jobId },
    });

    return Response.json(
      {
        requestId,
        planId,
        jobId: job.jobId,
        accepted: true,
        status: 'queued',
        summary: job.summary,
        // Fetch detailed checks + blocking issues via /v1/ops/jobs/{jobId} once completed.
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.toLowerCase().includes('missing bearer token') || message.toLowerCase().includes('invalid bearer token')) {
      return jsonError(401, 'unauthorized', message, requestId);
    }
    if (message.toLowerCase().startsWith('forbidden')) {
      return jsonError(403, 'forbidden', message, requestId);
    }
    if (message.toLowerCase().includes('plan not found')) {
      return jsonError(400, 'bad_request', message, requestId);
    }

    return jsonError(500, 'internal_error', message, requestId);
  }
}
