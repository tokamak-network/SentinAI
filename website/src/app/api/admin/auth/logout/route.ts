import { NextResponse } from 'next/server';
import { clearAdminSessionCookie } from '@/lib/admin-session';

export async function POST() {
  try {
    const response = NextResponse.json({ ok: true });
    response.headers.set('Set-Cookie', clearAdminSessionCookie());
    return response;
  } catch (error) {
    console.error('[Admin Logout API] Error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
