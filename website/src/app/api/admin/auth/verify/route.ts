import { NextRequest, NextResponse } from 'next/server';
import { getAdminNonceStore } from '@/lib/admin-nonce-store';
import {
  getAdminAddress,
  issueAdminSessionToken,
  buildAdminSessionCookie,
  verifySIWESignature,
} from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, signature, message } = body;

    // Validate request format
    if (!address || !signature || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: address, signature, message' },
        { status: 400 }
      );
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json(
        { error: 'Invalid address format' },
        { status: 400 }
      );
    }

    // Validate signature format (0x + 130 hex chars = 65 bytes)
    if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
      return NextResponse.json(
        { error: 'Invalid signature format' },
        { status: 400 }
      );
    }

    // Validate message format (should contain nonce)
    if (typeof message !== 'string' || message.length === 0) {
      return NextResponse.json(
        { error: 'Invalid message format' },
        { status: 400 }
      );
    }

    // Extract nonce from message
    const nonceMatch = message.match(/Nonce: ([a-f0-9]{32})/i);
    if (!nonceMatch) {
      return NextResponse.json(
        { error: 'Message does not contain valid nonce' },
        { status: 400 }
      );
    }

    const nonce = nonceMatch[1];

    // Consume nonce (1-use pattern)
    const nonceStore = getAdminNonceStore();
    const nonceValid = await nonceStore.consume(address as `0x${string}`, nonce);
    if (!nonceValid) {
      return NextResponse.json(
        { error: 'Nonce expired, invalid, or already used' },
        { status: 401 }
      );
    }

    // Verify SIWE signature
    const signatureValid = await verifySIWESignature(
      address as `0x${string}`,
      message,
      signature
    );
    if (!signatureValid) {
      return NextResponse.json(
        { error: 'Signature verification failed' },
        { status: 401 }
      );
    }

    // Verify address is admin
    const adminAddress = getAdminAddress();
    if (!adminAddress || address.toLowerCase() !== adminAddress.toLowerCase()) {
      return NextResponse.json(
        { error: 'Not authorized as admin' },
        { status: 403 }
      );
    }

    // Issue session token
    const token = issueAdminSessionToken(address as `0x${string}`);
    const sessionCookie = buildAdminSessionCookie(token);

    // Return response with Set-Cookie header
    const response = NextResponse.json({ ok: true });
    response.headers.set('Set-Cookie', sessionCookie);

    return response;
  } catch (error) {
    console.error('[Admin Verify API] Error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
