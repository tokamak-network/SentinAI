import { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/lib/ops-adapter/auth';
import { writeAuditLog } from '@/lib/ops-adapter/audit';
import { requireOpsPlan, createOpsJob } from '@/lib/ops-adapter/store';
import { jsonError } from '@/lib/ops-adapter/http';
import { enqueueOpsJob } from '@/lib/ops-adapter/worker';

export const dynamic = 'force-dynamic';

function liveExecAllowed(): boolean {
  return process.env.SENTINAI_ADAPTER_ALLOW_LIVE_EXECUTION === 'true';
}

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

    const confirmToken = typeof body?.confirmToken === 'string' ? body.confirmToken : undefined;
    if (!confirmToken || confirmToken.trim().length === 0) {
      return jsonError(400, 'bad_request', 'confirmToken is required', requestId);
    }

    const plan = requireOpsPlan(planId);
    if (confirmToken !== plan.confirmToken) {
      return jsonError(403, 'forbidden', 'Invalid confirmToken', requestId);
    }

    const dryRun = body?.dryRun !== false;
    if (!dryRun) {
      // Hard safety rail for demo.
      requireRole(actor, 'admin');
      if (!liveExecAllowed()) {
        return jsonError(403, 'forbidden', 'Live execution is disabled (set SENTINAI_ADAPTER_ALLOW_LIVE_EXECUTION=true)', requestId);
      }
    }

    const job = createOpsJob({
      type: 'execute',
      requestId,
      planId,
      dryRun,
      summary: `execute planId=${planId} dryRun=${dryRun}`,
    });

    enqueueOpsJob({
      jobId: job.jobId,
      type: 'execute',
      actor,
      requestId,
      payload: { planId, requestId, dryRun },
    });

    await writeAuditLog({
      at: new Date().toISOString(),
      actor,
      action: 'ops.execute.queued',
      requestId,
      metadata: { planId, jobId: job.jobId, dryRun },
    });

    return Response.json(
      {
        requestId,
        jobId: job.jobId,
        accepted: true,
        status: 'queued',
        dryRun,
        summary: job.summary,
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
