/**
 * OAuth 2.0 Dynamic Client Registration Endpoint — RFC 7591
 * ChatGPT Apps SDK performs DCR before starting the OAuth flow.
 * Returns a unique client_id and client_secret for each registration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { registerDynamicClient } from '@/lib/oauth-token';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    // Accept registrations with no body (redirect_uris defaults to empty)
  }

  const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const { clientId, clientSecret } = registerDynamicClient(redirectUris);

  // RFC 7591 response
  return NextResponse.json(
    {
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0, // 0 = never expires
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    },
    { status: 201 }
  );
}
