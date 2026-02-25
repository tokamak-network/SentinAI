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
    const resp = await fetch(`${baseUrl}/api/scaler`, { cache: 'no-store' });

    if (!resp.ok) {
      return jsonError(502, 'upstream_error', `Internal scaler API returned ${resp.status}`);
    }

    const data = await resp.json();

    return Response.json({
      currentVcpu: data.currentVcpu,
      autoScalingEnabled: data.autoScalingEnabled,
      simulationMode: data.simulationMode,
      cooldownRemaining: data.cooldownRemaining,
      lastScalingTime: data.lastScalingTime,
      scalingScore: data.scalingScore,
      prediction: data.prediction,
      zeroDowntime: data.zeroDowntime,
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
