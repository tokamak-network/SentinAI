/**
 * OAuth 2.0 Authorization Endpoint
 * Handles authorization code flow for ChatGPT MCP app registration.
 * Auto-approves requests with valid client_id (no user login required for M2M).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOAuthClientId, issueAuthCode } from '@/lib/oauth-token';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('client_id');
  const redirectUri = searchParams.get('redirect_uri');
  const responseType = searchParams.get('response_type');
  const state = searchParams.get('state');

  if (responseType !== 'code') {
    return NextResponse.json(
      { error: 'unsupported_response_type', error_description: 'Only response_type=code is supported.' },
      { status: 400 }
    );
  }

  if (clientId !== getOAuthClientId()) {
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

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectUri);
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'redirect_uri is not a valid URL.' },
      { status: 400 }
    );
  }

  const code = issueAuthCode(clientId);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  return NextResponse.redirect(redirectUrl.toString());
}
