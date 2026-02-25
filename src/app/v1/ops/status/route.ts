import { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/lib/ops-adapter/auth';
import { jsonError } from '@/lib/ops-adapter/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const actor = requireAuth(request);
    requireRole(actor, 'viewer');

    const timestamp = new Date().toISOString();

    // MVP: dependency checks are shallow, just surface config presence.
    const deps = [
      {
        name: 'k8s',
        status: process.env.AWS_CLUSTER_NAME ? 'ok' : 'degraded',
        detail: process.env.AWS_CLUSTER_NAME ? `AWS_CLUSTER_NAME=${process.env.AWS_CLUSTER_NAME}` : 'AWS_CLUSTER_NAME not set',
      },
      {
        name: 'mcp',
        status: process.env.MCP_SERVER_ENABLED === 'true' ? 'ok' : 'degraded',
        detail: process.env.MCP_SERVER_ENABLED === 'true' ? 'enabled' : 'disabled',
      },
      {
        name: 'adapter',
        status: 'ok',
        detail: 'v1 ops adapter online',
      },
    ];

    const overall = deps.some((d) => d.status === 'down')
      ? 'down'
      : deps.some((d) => d.status === 'degraded')
        ? 'degraded'
        : 'ok';

    return Response.json({
      status: overall,
      timestamp,
      version: process.env.NEXT_PUBLIC_APP_VERSION || 'dev',
      dependencies: deps,
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
