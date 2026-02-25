import { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/lib/ops-adapter/auth';
import { jsonError } from '@/lib/ops-adapter/http';

export const dynamic = 'force-dynamic';

function getBaseUrl(request: NextRequest): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(request: NextRequest) {
  try {
    const actor = requireAuth(request);
    requireRole(actor, 'viewer');

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const severity = url.searchParams.get('severity');
    const fromTs = url.searchParams.get('fromTs');
    const toTs = url.searchParams.get('toTs');

    const queryParams = new URLSearchParams();
    queryParams.append('limit', limit.toString());
    if (severity) queryParams.append('severity', severity);
    if (fromTs) queryParams.append('fromTs', fromTs);
    if (toTs) queryParams.append('toTs', toTs);

    const baseUrl = getBaseUrl(request);
    const resp = await fetch(`${baseUrl}/api/agent-decisions?${queryParams.toString()}`, {
      cache: 'no-store',
    });

    if (!resp.ok) {
      return jsonError(
        502,
        'upstream_error',
        `Internal agent-decisions API returned ${resp.status}`
      );
    }

    const data = await resp.json();

    return Response.json({
      traces: data.traces || [],
      total: data.total || 0,
      limit,
    });
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
