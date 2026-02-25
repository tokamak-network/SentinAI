import { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/lib/ops-adapter/auth';
import { getOpsJobStore } from '@/lib/ops-adapter/store';
import { jsonError } from '@/lib/ops-adapter/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  try {
    const actor = requireAuth(request);
    requireRole(actor, 'viewer');

    const { jobId } = await ctx.params;
    const job = getOpsJobStore().get(jobId);
    if (!job) {
      return jsonError(404, 'not_found', 'Job not found');
    }

    return Response.json({
      jobId: job.jobId,
      type: job.type,
      status: job.status,
      progress: job.progress,
      summary: job.summary,
      logs: job.logs,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt,
      requestId: job.requestId,
      planId: job.planId,
      operationId: job.operationId,
      dryRun: job.dryRun,
      result: job.result,
      error: job.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.toLowerCase().includes('missing bearer token') || message.toLowerCase().includes('invalid bearer token')) {
      return jsonError(401, 'unauthorized', message);
    }
    if (message.toLowerCase().startsWith('forbidden')) {
      return jsonError(403, 'forbidden', message);
    }
    return jsonError(500, 'internal_error', message);
  }
}
