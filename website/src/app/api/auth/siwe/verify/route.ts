import { NextRequest, NextResponse } from 'next/server';
import { getNonceStore } from '@/lib/nonce-store';
import {
  getAdminAddress,
  generateSiweMessage,
  verifySiweMessage,
  issueSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from '@/lib/siwe-session';

/**
 * POST /api/auth/siwe/verify
 * Verifies SIWE signature and issues session cookie.
 *
 * Request body:
 * {
 *   "address": "0x...",
 *   "nonce": "...",
 *   "message": "...",
 *   "signature": "0x..."
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, nonce, message, signature } = body;

    // Validate inputs
    if (!address || !nonce || !message || !signature) {
      return NextResponse.json(
        { error: 'Missing required fields: address, nonce, message, signature' },
        { status: 400 }
      );
    }

    if (!address.startsWith('0x') || address.length !== 42) {
      return NextResponse.json(
        { error: 'Invalid address format' },
        { status: 400 }
      );
    }

    // Get admin address
    const adminAddress = getAdminAddress();
    if (!adminAddress) {
      console.error('[Verify Route] Admin address not configured');
      return NextResponse.json(
        { error: 'Admin not configured' },
        { status: 500 }
      );
    }

    // Check if address matches admin
    if (address.toLowerCase() !== adminAddress.toLowerCase()) {
      return NextResponse.json(
        { error: 'Only admin address can authenticate' },
        { status: 403 }
      );
    }

    // Consume nonce (one-time use)
    const nonceStore = getNonceStore();
    const nonceValid = await nonceStore.consume(address as `0x${string}`, nonce);

    if (!nonceValid) {
      return NextResponse.json(
        { error: 'Invalid or expired nonce' },
        { status: 403 }
      );
    }

    // Verify SIWE message signature
    const signatureValid = await verifySiweMessage(
      message,
      signature,
      address as `0x${string}`
    );

    if (!signatureValid) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 403 }
      );
    }

    // Issue session token
    const sessionToken = issueSessionToken(address as `0x${string}`);

    // Create response with session cookie
    const response = NextResponse.json(
      {
        success: true,
        address,
        expiresIn: Math.floor(SESSION_TTL_MS / 1000),
      },
      { status: 200 }
    );

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });

    return response;
  } catch (error) {
    console.error('[Verify Route] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to verify signature' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
