import { NextRequest, NextResponse } from 'next/server';
import { verifySIWESignature, issueAdminSessionToken, ADMIN_SESSION_COOKIE_NAME, ADMIN_SESSION_TTL_SECONDS } from '@/lib/admin-session';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, signature, message } = body;

    // Validate inputs
    if (!address || !signature || !message) {
      return NextResponse.json(
        { error: 'Missing address, signature, or message' },
        { status: 400 }
      );
    }

    // Verify SIWE signature
    const isValid = await verifySIWESignature(address, message, signature);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 403 }
      );
    }

    // Create session token
    const token = issueAdminSessionToken(address);

    // Create response
    const response = NextResponse.json(
      { success: true, address },
      { status: 200 }
    );

    // Set session cookie
    response.cookies.set(ADMIN_SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: ADMIN_SESSION_TTL_SECONDS,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Verification error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
