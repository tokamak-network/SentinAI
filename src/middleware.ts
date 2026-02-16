/**
 * Middleware for API Authentication and Read-Only Mode Protection
 *
 * 1. API Key Guard: When SENTINAI_API_KEY is set, all write operations (POST/PATCH/DELETE/PUT)
 *    require a valid x-api-key header. Internal routes (health, agent-loop, metrics/seed) are exempt.
 * 2. Read-Only Mode: When SENTINAI_READ_ONLY_MODE is enabled, blocks write operations
 *    except for whitelisted safe endpoints.
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
 * Get configured API key (undefined = auth disabled)
 */
function getApiKey(): string | undefined {
  return process.env.SENTINAI_API_KEY || undefined;
}

/**
 * Middleware configuration - applies to all /api/* routes
 */
export const config = {
  matcher: '/api/:path*',
};

/**
 * Routes exempt from API key authentication (internal/automated endpoints)
 */
const AUTH_EXEMPT_ROUTES = [
  '/api/health',
  '/api/agent-loop',
  '/api/metrics/seed',
];

/**
 * Main middleware function
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // Always allow exempt routes (health checks, internal automation)
  if (AUTH_EXEMPT_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Allow all GET requests (read-only operations)
  if (method === 'GET') {
    return NextResponse.next();
  }

  // --- Layer 1: API Key Authentication (when configured) ---
  const apiKey = getApiKey();
  if (apiKey && ['POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) {
    const providedKey = request.headers.get('x-api-key');
    if (providedKey !== apiKey) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing x-api-key' },
        { status: 401 }
      );
    }
  }

  // --- Layer 2: Read-Only Mode (blocks writes even with valid API key) ---
  if (isReadOnlyMode()) {
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) {
      // Exceptions: safe endpoints in read-only mode
      const safeEndpoints = [
        '/api/reports/daily/send', // Slack delivery (read-only)
        '/api/rca',               // RCA analysis (read-only)
        '/api/nlops',             // NLOps chat (dangerous commands filtered in handler)
      ];

      if (safeEndpoints.some(endpoint => pathname === endpoint)) {
        return NextResponse.next();
      }

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
