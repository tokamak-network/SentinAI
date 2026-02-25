/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 * Required for MCP 2025-03-26 OAuth discovery.
 * Tells clients which authorization server to use for this MCP resource.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const base = `${origin}${basePath}`;

  return NextResponse.json({
    resource: base,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  });
}
