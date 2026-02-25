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

    const baseUrl = getBaseUrl(request);
    const resp = await fetch(`${baseUrl}/api/l1-failover`, { cache: 'no-store' });

    if (!resp.ok) {
      return jsonError(502, 'upstream_error', `Internal l1-failover API returned ${resp.status}`);
    }

    const data = await resp.json();

    return Response.json({
      activeUrl: data.activeUrl,
      failoverCount: data.failoverCount,
      healthy: data.healthy,
      lastFailover: data.lastFailover,
      poolSize: data.poolSize,
      status: data.status,
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
