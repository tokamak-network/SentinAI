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

function resolveApiKey(request: NextRequest): string | undefined {
  const xApiKey = request.headers.get('x-api-key') || undefined;
  if (xApiKey) return xApiKey;
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (validateBearerToken(token)) return process.env.SENTINAI_API_KEY;
  }
  return undefined;
}

function unauthorized(request: NextRequest): NextResponse {
  return NextResponse.json(
    { error: 'unauthorized', error_description: 'Bearer token required.' },
    { status: 401, headers: { 'WWW-Authenticate': buildWwwAuthenticate(request) } }
  );
}

export async function GET(request: NextRequest) {
  const config = getMcpConfig();
  if (!config.enabled) {
    return NextResponse.json({ enabled: false, message: 'MCP server is disabled.' }, { status: 503 });
  }

  // Always return 401 when API key is configured and no auth provided.
  // This forces ChatGPT to discover and complete the OAuth flow.
  if (process.env.SENTINAI_API_KEY && !resolveApiKey(request)) {
    return unauthorized(request);
  }

  return NextResponse.json(
    {
      enabled: true,
      authMode: config.authMode,
      approvalRequired: config.approvalRequired,
      approvalTtlSeconds: config.approvalTtlSeconds,
      tools: getMcpToolManifest(),
    },
    { headers: { 'WWW-Authenticate': buildWwwAuthenticate(request) } }
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

  // Require auth for all requests when SENTINAI_API_KEY is configured.
  // Returning 401 on every unauthenticated request (including initialize)
  // is required for ChatGPT to detect and initiate the OAuth flow.
  const apiKey = resolveApiKey(request);
  if (process.env.SENTINAI_API_KEY && !apiKey) {
    return unauthorized(request);
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
