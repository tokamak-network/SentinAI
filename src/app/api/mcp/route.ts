/**
 * MCP API Route
 * GET: MCP capability and tool manifest
 * POST: JSON-RPC MCP tool invocation
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getMcpConfig, getMcpToolManifest, handleMcpRequest } from '@/lib/mcp-server';
import { validateBearerToken } from '@/lib/oauth-token';
import { getPublicBase } from '@/lib/public-url';

export const dynamic = 'force-dynamic';

function buildWwwAuthenticate(request: NextRequest): string {
  const base = getPublicBase(request);
  return `Bearer realm="SentinAI", resource_metadata="${base}/.well-known/oauth-protected-resource"`;
}

export async function GET(request: NextRequest) {
  const config = getMcpConfig();
  if (!config.enabled) {
    return NextResponse.json(
      {
        enabled: false,
        message: 'MCP server is disabled.',
      },
      { status: 503 }
    );
  }

  // Advertise OAuth support via WWW-Authenticate header (MCP 2025-03-26)
  return NextResponse.json(
    {
      enabled: true,
      authMode: config.authMode,
      approvalRequired: config.approvalRequired,
      approvalTtlSeconds: config.approvalTtlSeconds,
      tools: getMcpToolManifest(),
    },
    {
      headers: {
        'WWW-Authenticate': buildWwwAuthenticate(request),
      },
    }
  );
}

export async function POST(request: NextRequest) {
  const config = getMcpConfig();
  if (!config.enabled) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32004,
          message: 'MCP server is disabled.',
        },
      },
      { status: 503 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Failed to parse JSON payload.',
        },
      },
      { status: 400 }
    );
  }

  // Accept both x-api-key header and OAuth Bearer token
  let apiKey = request.headers.get('x-api-key') || undefined;
  const authHeader = request.headers.get('authorization');
  if (!apiKey && authHeader?.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7);
    if (validateBearerToken(bearerToken)) {
      apiKey = process.env.SENTINAI_API_KEY;
    }
  }

  // Return HTTP 401 with WWW-Authenticate when no auth is provided at all.
  // This enables ChatGPT OAuth discovery (MCP 2025-03-26 spec).
  // initialize and tools/list are exempted — they don't require auth.
  const configuredApiKey = process.env.SENTINAI_API_KEY;
  const isDiscoveryMethod =
    typeof payload === 'object' &&
    payload !== null &&
    'method' in payload &&
    (payload.method === 'initialize' || payload.method === 'tools/list' || payload.method === 'resources/list');

  if (configuredApiKey && !apiKey && !isDiscoveryMethod) {
    return NextResponse.json(
      { error: 'unauthorized', error_description: 'Bearer token required.' },
      {
        status: 401,
        headers: { 'WWW-Authenticate': buildWwwAuthenticate(request) },
      }
    );
  }

  const response = await handleMcpRequest(payload, {
    requestId: request.headers.get('x-request-id') || randomUUID(),
    apiKey,
    approvalToken: request.headers.get('x-mcp-approval-token') || undefined,
    readOnlyMode: process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true',
    allowScalerWriteInReadOnly: process.env.SENTINAI_ALLOW_SCALER_WRITE_IN_READONLY === 'true',
  });

  return NextResponse.json(response);
}
