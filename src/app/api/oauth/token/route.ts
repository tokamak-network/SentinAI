/**
 * OAuth 2.0 Token Endpoint
 * Issues access tokens for ChatGPT MCP app authentication.
 * Supports: authorization_code, client_credentials grant types.
 * Client credentials accepted via Basic auth header or request body.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getOAuthClientId,
  getOAuthClientSecret,
  consumeAuthCode,
  deriveAccessToken,
  ACCESS_TOKEN_TTL_SECONDS,
} from '@/lib/oauth-token';

export const dynamic = 'force-dynamic';

function extractClientCredentials(
  request: NextRequest,
  body: URLSearchParams
): { clientId: string | null; clientSecret: string | null } {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex !== -1) {
      return {
        clientId: decoded.slice(0, colonIndex) || null,
        clientSecret: decoded.slice(colonIndex + 1) || null,
      };
    }
  }
  return {
    clientId: body.get('client_id'),
    clientSecret: body.get('client_secret'),
  };
}

export async function POST(request: NextRequest) {
  let body: URLSearchParams;
  try {
    const text = await request.text();
    body = new URLSearchParams(text);
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const configuredSecret = getOAuthClientSecret();
  if (!configuredSecret) {
    return NextResponse.json(
      { error: 'server_error', error_description: 'OAuth is not configured on this server.' },
      { status: 500 }
    );
  }

  const { clientId, clientSecret } = extractClientCredentials(request, body);
  const configuredClientId = getOAuthClientId();

  if (clientId !== configuredClientId || clientSecret !== configuredSecret) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
  }

  const grantType = body.get('grant_type');

  if (grantType === 'client_credentials') {
    return NextResponse.json({
      access_token: deriveAccessToken(configuredSecret),
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  if (grantType === 'authorization_code') {
    const code = body.get('code');
    if (!code || !consumeAuthCode(code, clientId)) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Authorization code is invalid or expired.' },
        { status: 400 }
      );
    }
    return NextResponse.json({
      access_token: deriveAccessToken(configuredSecret),
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  return NextResponse.json(
    { error: 'unsupported_grant_type', error_description: 'Supported: authorization_code, client_credentials.' },
    { status: 400 }
  );
}
