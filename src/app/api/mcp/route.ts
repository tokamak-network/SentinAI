/**
 * MCP API Route
 * GET: MCP capability and tool manifest
 * POST: JSON-RPC MCP tool invocation
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getMcpConfig, getMcpToolManifest, handleMcpRequest } from '@/lib/mcp-server';

export const dynamic = 'force-dynamic';

export async function GET() {
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

  return NextResponse.json({
    enabled: true,
    authMode: config.authMode,
    approvalRequired: config.approvalRequired,
    approvalTtlSeconds: config.approvalTtlSeconds,
    tools: getMcpToolManifest(),
  });
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

  const response = await handleMcpRequest(payload, {
    requestId: request.headers.get('x-request-id') || randomUUID(),
    apiKey: request.headers.get('x-api-key') || undefined,
    approvalToken: request.headers.get('x-mcp-approval-token') || undefined,
    readOnlyMode: process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true',
    allowScalerWriteInReadOnly: process.env.SENTINAI_ALLOW_SCALER_WRITE_IN_READONLY === 'true',
  });

  return NextResponse.json(response);
}
