import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/siwe-session';

/**
 * POST /api/auth/siwe/logout
 * Clears the session cookie and redirects to login.
 */
export async function POST(request: NextRequest) {
  try {
    const response = NextResponse.json(
      { success: true },
      { status: 200 }
    );

    // Clear session cookie
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: '',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error('[Logout Route] POST error:', error);
    return NextResponse.json(
      { error: 'Logout failed' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
