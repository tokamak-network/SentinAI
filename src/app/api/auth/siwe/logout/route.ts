/**
 * POST /api/auth/siwe/logout
 * Clears session cookie.
 * Response: 204 No Content with Set-Cookie header to clear cookie
 */

import { clearSessionCookie } from '@/lib/siwe-session';
import logger from '@/lib/logger';

export async function POST(): Promise<Response> {
  try {
    const response = new Response(null, { status: 204 });
    response.headers.set('Set-Cookie', clearSessionCookie());
    logger.info('[SIWE Logout] Session cleared');
    return response;
  } catch (error) {
    logger.error('[SIWE Logout] Error during logout:', error);
    return new Response(null, { status: 204 });
  }
}
