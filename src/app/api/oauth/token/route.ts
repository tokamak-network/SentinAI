/**
 * OAuth 2.0 Token Endpoint — RFC 6749 + PKCE (RFC 7636)
 * Issues access tokens for ChatGPT MCP app authentication.
 * Supports:
 *   - authorization_code + PKCE (ChatGPT's required flow)
 *   - client_credentials (legacy / direct API users)
 * Client auth via Basic header or request body.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getOAuthClientId,
  getOAuthClientSecret,
  validateDynamicClient,
  consumeAuthCode,
  issueAccessToken,
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
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const colonIndex = decoded.indexOf(':');
      if (colonIndex !== -1) {
        return {
          clientId: decoded.slice(0, colonIndex) || null,
          clientSecret: decoded.slice(colonIndex + 1) || null,
        };
      }
    } catch {
      // fall through to body
    }
  }
  return {
    clientId: body.get('client_id'),
    clientSecret: body.get('client_secret'),
  };
}

/** Validate client credentials: accepts both static and DCR clients. */
function isValidClient(clientId: string | null, clientSecret: string | null): boolean {
  if (!clientId || !clientSecret) return false;

  // Static pre-configured client
  const staticId = getOAuthClientId();
  const staticSecret = getOAuthClientSecret();
  if (clientId === staticId && staticSecret && clientSecret === staticSecret) return true;

  // Dynamic DCR client
  return validateDynamicClient(clientId, clientSecret);
}

export async function POST(request: NextRequest) {
  let body: URLSearchParams;
  try {
    const text = await request.text();
    body = new URLSearchParams(text);
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const { clientId, clientSecret } = extractClientCredentials(request, body);

  if (!isValidClient(clientId, clientSecret)) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
  }

  const grantType = body.get('grant_type');

  if (grantType === 'authorization_code') {
    const code = body.get('code');
    const codeVerifier = body.get('code_verifier') || undefined;

    if (!code || !clientId) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'code is required.' },
        { status: 400 }
      );
    }

    if (!consumeAuthCode(code, clientId, codeVerifier)) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Authorization code is invalid, expired, or PKCE verification failed.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      access_token: issueAccessToken(),
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  if (grantType === 'client_credentials') {
    const configuredSecret = getOAuthClientSecret();
    if (!configuredSecret) {
      return NextResponse.json(
        { error: 'server_error', error_description: 'OAuth is not configured.' },
        { status: 500 }
      );
    }
    // Static client only for client_credentials
    if (clientId !== getOAuthClientId()) {
      return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
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
