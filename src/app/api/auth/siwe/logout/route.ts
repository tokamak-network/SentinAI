/**
 * POST /api/auth/siwe/logout
 * Clears session cookie and redirects to /login.
 */

import { clearSessionCookie } from '@/lib/siwe-session';

export async function POST(): Promise<Response> {
  const response = Response.redirect('/login', 303);
  response.headers.set('Set-Cookie', clearSessionCookie());
  return response;
}
