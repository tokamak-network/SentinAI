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

    const baseUrl = getBaseUrl(request);
    const resp = await fetch(`${baseUrl}/api/metrics`, { cache: 'no-store' });

    if (!resp.ok) {
      return jsonError(502, 'upstream_error', `Internal metrics API returned ${resp.status}`);
    }

    const data = await resp.json();

    // ChatGPT-optimized response: only core fields
    return Response.json({
      timestamp: data.timestamp,
      chain: {
        type: data.chain?.type,
        displayName: data.chain?.displayName,
        mode: data.chain?.mode,
      },
      metrics: {
        l1BlockHeight: data.metrics?.l1BlockHeight,
        blockHeight: data.metrics?.blockHeight,
        txPoolCount: data.metrics?.txPoolCount,
        cpuUsage: data.metrics?.cpuUsage,
        gethVcpu: data.metrics?.gethVcpu,
        syncLag: data.metrics?.syncLag,
        gasUsage: data.metrics?.gasUsage,
      },
      components: data.components,
      status: data.status,
      eoaBalances: data.eoaBalances,
      derivationLag: data.derivationLag,
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
