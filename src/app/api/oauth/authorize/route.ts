/**
 * OAuth 2.0 Authorization Endpoint — RFC 6749 + PKCE (RFC 7636)
 * Handles authorization code flow with PKCE for ChatGPT MCP app registration.
 * Auto-approves all requests (no user login needed — MCP is a service connection).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOAuthClientId, getDynamicClient, issueAuthCode } from '@/lib/oauth-token';

export const dynamic = 'force-dynamic';

/** ChatGPT's production redirect URI (must be allowed). */
const ALLOWED_REDIRECT_ORIGINS = [
  'https://chatgpt.com',
  'https://platform.openai.com',
];

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    // Allow ChatGPT's redirect URIs
    if (ALLOWED_REDIRECT_ORIGINS.some(origin => url.origin === origin)) return true;
    // Allow localhost for development
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
    return false;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('client_id');
  const redirectUri = searchParams.get('redirect_uri');
  const responseType = searchParams.get('response_type');
  const state = searchParams.get('state');
  const codeChallenge = searchParams.get('code_challenge') || undefined;
  const codeChallengeMethod = searchParams.get('code_challenge_method') || undefined;

  if (responseType !== 'code') {
    return NextResponse.json(
      { error: 'unsupported_response_type', error_description: 'Only response_type=code is supported.' },
      { status: 400 }
    );
  }

  if (!clientId) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'client_id is required.' },
      { status: 400 }
    );
  }

  // Accept both static client and dynamic DCR clients
  const isStaticClient = clientId === getOAuthClientId();
  const isDynamicClient = !isStaticClient && !!getDynamicClient(clientId);

  if (!isStaticClient && !isDynamicClient) {
    return NextResponse.json(
      { error: 'unauthorized_client', error_description: 'Unknown client_id.' },
      { status: 401 }
    );
  }

  if (!redirectUri) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'redirect_uri is required.' },
      { status: 400 }
    );
  }

  if (!isAllowedRedirectUri(redirectUri)) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'redirect_uri is not allowed.' },
      { status: 400 }
    );
  }

  // PKCE: S256 is the only supported method
  if (codeChallenge && codeChallengeMethod && codeChallengeMethod !== 'S256') {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Only code_challenge_method=S256 is supported.' },
      { status: 400 }
    );
  }

  // Auto-approve: issue the authorization code
  const code = issueAuthCode(clientId, codeChallenge, codeChallengeMethod);

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectUri);
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'redirect_uri is not a valid URL.' },
      { status: 400 }
    );
  }

  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  return NextResponse.redirect(redirectUrl.toString());
}
