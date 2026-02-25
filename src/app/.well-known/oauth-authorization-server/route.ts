/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * Required for MCP 2025-03-26 OAuth discovery.
 * ChatGPT uses this to discover token/authorize endpoints automatically.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const base = `${origin}${basePath}`;

  return NextResponse.json({
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: ['mcp'],
    code_challenge_methods_supported: ['S256'],
  });
}
