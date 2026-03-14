import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/siwe-session';

export const config = {
  matcher: ['/v2/marketplace', '/v2/marketplace/:path*'],
};

export function middleware(request: NextRequest) {
  // Get session cookie
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);

  if (!sessionCookie || !sessionCookie.value) {
    // No session, redirect to login with callback URL
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // Verify session token
  const session = verifySessionToken(sessionCookie.value);

  if (!session) {
    // Invalid or expired session, redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname + request.nextUrl.search);

    const response = NextResponse.redirect(loginUrl);
    // Clear invalid cookie
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
  }

  // Session is valid, allow request
  return NextResponse.next();
}
