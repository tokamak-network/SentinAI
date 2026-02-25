import { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/lib/ops-adapter/auth';
import { writeAuditLog } from '@/lib/ops-adapter/audit';
import { createOpsJob, findOpsJobByOperationId, requireOpsJob, requireOpsPlan } from '@/lib/ops-adapter/store';
import { jsonError } from '@/lib/ops-adapter/http';
import { enqueueOpsJob } from '@/lib/ops-adapter/worker';

export const dynamic = 'force-dynamic';

function liveRollbackAllowed(): boolean {
  // Reuse the same safety rail env as live execution.
  return process.env.SENTINAI_ADAPTER_ALLOW_LIVE_EXECUTION === 'true';
}

export async function POST(request: NextRequest) {
  let requestId: string | undefined;
  try {
    const actor = requireAuth(request);
    requireRole(actor, 'admin');

    const body = await request.json();
    requestId = typeof body?.requestId === 'string' ? body.requestId : undefined;

    if (!requestId || requestId.trim().length === 0) {
      return jsonError(400, 'bad_request', 'requestId is required');
    }

    const confirmToken = typeof body?.confirmToken === 'string' ? body.confirmToken : undefined;
    if (!confirmToken || confirmToken.trim().length === 0) {
      return jsonError(400, 'bad_request', 'confirmToken is required', requestId);
    }

    const dryRun = body?.dryRun !== false;
    if (!dryRun && !liveRollbackAllowed()) {
      return jsonError(403, 'forbidden', 'Live rollback is disabled (set SENTINAI_ADAPTER_ALLOW_LIVE_EXECUTION=true)', requestId);
    }

    const operationId = typeof body?.operationId === 'string' ? body.operationId : undefined;
    const sourceJobId = typeof body?.sourceJobId === 'string' ? body.sourceJobId : undefined;

    if ((!operationId || operationId.trim().length === 0) && (!sourceJobId || sourceJobId.trim().length === 0)) {
      return jsonError(400, 'bad_request', 'operationId or sourceJobId is required', requestId);
    }

    let resolvedOperationId: string | undefined = operationId?.trim();
    let resolvedPlanId: string | undefined;

    if (!resolvedOperationId && sourceJobId) {
      const sourceJob = requireOpsJob(sourceJobId);
      resolvedOperationId = sourceJob.operationId;
      resolvedPlanId = sourceJob.planId;
      if (!resolvedOperationId) {
        return jsonError(400, 'bad_request', 'sourceJobId has no operationId', requestId);
      }
    }

    if (!resolvedPlanId && resolvedOperationId) {
      const linked = findOpsJobByOperationId(resolvedOperationId);
      resolvedPlanId = linked?.planId;
    }

    if (resolvedPlanId) {
      const plan = requireOpsPlan(resolvedPlanId);
      if (confirmToken !== plan.confirmToken) {
        return jsonError(403, 'forbidden', 'Invalid confirmToken', requestId);
      }
    } else {
      // If we can't resolve planId, we cannot validate confirmToken against a stored plan.
      return jsonError(400, 'bad_request', 'Unable to resolve planId for confirmToken validation (provide sourceJobId from /v1/ops/execute)', requestId);
    }

    if (!resolvedOperationId) {
      return jsonError(400, 'bad_request', 'Unable to resolve operationId', requestId);
    }

    const job = createOpsJob({
      type: 'rollback',
      requestId,
      operationId: resolvedOperationId,
      dryRun,
      summary: `rollback operationId=${resolvedOperationId} dryRun=${dryRun}`,
    });

    enqueueOpsJob({
      jobId: job.jobId,
      type: 'rollback',
      actor,
      requestId,
      payload: { requestId, dryRun, operationId: resolvedOperationId, sourceJobId },
    });

    await writeAuditLog({
      at: new Date().toISOString(),
      actor,
      action: 'ops.rollback.queued',
      requestId,
      metadata: { jobId: job.jobId, operationId: resolvedOperationId, dryRun, sourceJobId },
    });

    return Response.json(
      {
        requestId,
        jobId: job.jobId,
        accepted: true,
        status: 'queued',
        dryRun,
        operationId: resolvedOperationId,
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
    if (message.toLowerCase().includes('plan not found') || message.toLowerCase().includes('job not found')) {
      return jsonError(400, 'bad_request', message, requestId);
    }
    return jsonError(500, 'internal_error', message, requestId);
  }
}
