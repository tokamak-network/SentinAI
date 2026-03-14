import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = 'sentinai_admin_session';

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true }, { status: 200 });

  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0, // Immediately expire
    path: '/',
  });

  return response;
}
