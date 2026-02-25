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
    const resp = await fetch(`${baseUrl}/api/policy/autonomy-level`, { cache: 'no-store' });

    if (!resp.ok) {
      return jsonError(
        502,
        'upstream_error',
        `Internal autonomy-level API returned ${resp.status}`
      );
    }

    const data = await resp.json();

    return Response.json(data);
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

export async function POST(request: NextRequest) {
  try {
    const actor = requireAuth(request);
    requireRole(actor, 'admin'); // Admin only for policy changes

    const body = await request.json();
    const level = body?.level;

    if (!level || !['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].includes(level)) {
      return jsonError(
        400,
        'bad_request',
        'level is required and must be one of: A0, A1, A2, A3, A4, A5'
      );
    }

    const baseUrl = getBaseUrl(request);
    const apiKey = process.env.SENTINAI_API_KEY || '';

    const resp = await fetch(`${baseUrl}/api/policy/autonomy-level`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (!resp.ok) {
      const upstreamData = await resp.json().catch(() => ({}));
      const statusCode = resp.status === 401 ? 403 : 502;
      const code = resp.status === 401 ? 'forbidden' : 'upstream_error';
      return jsonError(statusCode, code, upstreamData.error || `Policy update failed`);
    }

    const data = await resp.json();
    return Response.json(data);
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
