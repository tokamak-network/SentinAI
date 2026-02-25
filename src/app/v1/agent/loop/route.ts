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

    const baseUrl = getBaseUrl(request);
    const resp = await fetch(`${baseUrl}/api/agent-loop?limit=${limit}`, { cache: 'no-store' });

    if (!resp.ok) {
      return jsonError(502, 'upstream_error', `Internal agent-loop API returned ${resp.status}`);
    }

    const data = await resp.json();

    return Response.json({
      scheduler: data.scheduler,
      lastCycle: data.lastCycle,
      recentCycles: data.recentCycles,
      totalCycles: data.totalCycles,
      config: data.config,
      enabled: data.enabled,
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
