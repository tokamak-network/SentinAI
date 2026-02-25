import { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/lib/ops-adapter/auth';
import { jsonError } from '@/lib/ops-adapter/http';

export const dynamic = 'force-dynamic';

function getBaseUrl(request: NextRequest): string {
  const url = new URL(request.url);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return `${url.protocol}//${url.host}${basePath}`;
}

export async function GET(request: NextRequest) {
  try {
    const actor = requireAuth(request);
    requireRole(actor, 'viewer');

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const baseUrl = getBaseUrl(request);
    const resp = await fetch(`${baseUrl}/api/anomalies?limit=${limit}&offset=${offset}`, {
      cache: 'no-store',
    });

    if (!resp.ok) {
      return jsonError(502, 'upstream_error', `Internal anomalies API returned ${resp.status}`);
    }

    const data = await resp.json();

    return Response.json({
      events: data.events || [],
      total: data.total || 0,
      activeCount: data.activeCount || 0,
      limit,
      offset,
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
