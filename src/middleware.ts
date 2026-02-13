/**
 * Middleware for Read-Only Mode Protection
 * Blocks write operations (POST, PATCH, DELETE, PUT) when SENTINAI_READ_ONLY_MODE is enabled
 * Allows whitelisted endpoints for safe operations (reports delivery, RCA analysis, NLOps chat)
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Check if read-only mode is enabled
 */
function isReadOnlyMode(): boolean {
  return process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true';
}

/**
 * Middleware configuration - applies to all /api/* routes
 */
export const config = {
  matcher: '/api/:path*',
};

/**
 * Main middleware function - blocks write operations in read-only mode
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // Whitelist: Always allow these routes regardless of read-only mode
  const whitelist = ['/api/health', '/api/agent-loop'];

  if (whitelist.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Allow all GET requests (read-only operations)
  if (method === 'GET') {
    return NextResponse.next();
  }

  // Check read-only mode for write operations
  if (isReadOnlyMode()) {
    // Block write operations: POST, PATCH, DELETE, PUT
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) {
      // Exceptions: These endpoints are safe in read-only mode
      const safeEndpoints = [
        '/api/reports/daily/send', // Slack delivery (read-only)
        '/api/rca', // RCA analysis (read-only)
        '/api/nlops', // NLOps chat (dangerous commands filtered in handler)
      ];

      if (safeEndpoints.some(endpoint => pathname === endpoint)) {
        return NextResponse.next();
      }

      // Block all other write operations
      return NextResponse.json(
        {
          error: 'Write operations are disabled in read-only mode',
          readonly: true,
        },
        { status: 403 }
      );
    }
  }

  return NextResponse.next();
}
