import { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/lib/ops-adapter/auth';
import { jsonError } from '@/lib/ops-adapter/http';

export const dynamic = 'force-dynamic';

function getBaseUrl(request: NextRequest): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(request: NextRequest) {
  try {
    const actor = requireAuth(request);
    requireRole(actor, 'operator');

    const body = await request.json();
    const targetVcpu = typeof body?.targetVcpu === 'number' ? body.targetVcpu : undefined;

    if (!targetVcpu || ![1, 2, 4, 8].includes(targetVcpu)) {
      return jsonError(
        400,
        'bad_request',
        'targetVcpu is required and must be one of: 1, 2, 4, 8'
      );
    }

    const dryRun = body?.dryRun !== false; // Default to true for safety

    const baseUrl = getBaseUrl(request);
    const resp = await fetch(`${baseUrl}/api/scaler`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetVcpu,
        reason: typeof body?.reason === 'string' ? body.reason : 'ChatGPT Actions manual trigger',
        dryRun,
      }),
      cache: 'no-store',
    });

    if (!resp.ok) {
      const upstreamData = await resp.json().catch(() => ({}));
      return jsonError(
        502,
        'upstream_error',
        upstreamData.error || `Scaling failed with status ${resp.status}`
      );
    }

    const data = await resp.json();
    return Response.json(data, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (
      message.toLowerCase().includes('missing bearer token') ||
      message.toLowerCase().includes('invalid bearer token')
    ) {
      return jsonError(401, 'unauthorized', message);
    }
    if (message.toLowerCase().startsWith('forbidden')) {
      return jsonError(403, 'forbidden', message);
    }
    return jsonError(500, 'internal_error', message);
  }
}
