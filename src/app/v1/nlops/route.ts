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
    const message = typeof body?.message === 'string' ? body.message.trim() : undefined;

    if (!message || message.length === 0) {
      return jsonError(400, 'bad_request', 'message is required and cannot be empty');
    }

    if (message.length > 500) {
      return jsonError(400, 'bad_request', 'message must be 500 characters or less');
    }

    const baseUrl = getBaseUrl(request);
    const resp = await fetch(`${baseUrl}/api/nlops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        confirmAction: typeof body?.confirmAction === 'boolean' ? body.confirmAction : undefined,
      }),
      cache: 'no-store',
    });

    if (!resp.ok) {
      const upstreamData = await resp.json().catch(() => ({}));
      return jsonError(502, 'upstream_error', upstreamData.error || 'NLOps request failed');
    }

    const data = await resp.json();

    // Pass through the response as-is, preserving needsConfirmation for ChatGPT
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
