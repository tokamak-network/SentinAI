/**
 * Middleware for API Authentication and Read-Only Mode Protection
 *
 * 1. API Key Guard: When SENTINAI_API_KEY is set, all write operations (POST/PATCH/DELETE/PUT)
 *    require a valid x-api-key header. Internal routes (health, agent-loop) are exempt.
 * 2. Read-Only Mode: When SENTINAI_READ_ONLY_MODE is enabled, blocks write operations
 *    except for whitelisted safe endpoints.
 * 3. OAuth Well-Known: Serves RFC 8414/9728 discovery docs at domain root (bypasses basePath).
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Resolve public base URL from forwarded headers (avoids internal 0.0.0.0:port).
 * Inlined here because middleware runs on Edge Runtime — must avoid heavy module imports.
 */
function getPublicBaseFromRequest(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const forwardedHost =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost';
  const host = forwardedHost.split(',')[0].trim();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return `${proto}://${host}${basePath}`;
}

/**
 * Handle OAuth discovery endpoints at domain root (/.well-known/).
 * These must be served without basePath prefix per RFC 8414 / RFC 9728.
 */
function handleWellKnown(request: NextRequest, pathname: string): NextResponse | null {
  const base = getPublicBaseFromRequest(request);

  if (pathname === '/.well-known/oauth-protected-resource') {
    return NextResponse.json({
      resource: base,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
    });
  }

  if (pathname === '/.well-known/oauth-authorization-server') {
    return NextResponse.json({
      issuer: base,
      authorization_endpoint: `${base}/api/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'client_credentials'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      scopes_supported: ['mcp'],
      code_challenge_methods_supported: ['S256'],
    });
  }

  return null;
}

/**
 * Check if read-only mode is enabled
 */
function isReadOnlyMode(): boolean {
  return process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true';
}

/**
 * Allow scaler write APIs in read-only mode for controlled verification.
 */
function allowScalerWriteInReadOnlyMode(): boolean {
  return process.env.SENTINAI_ALLOW_SCALER_WRITE_IN_READONLY === 'true';
}

/**
 * Get configured API key (undefined = auth disabled)
 */
function getApiKey(): string | undefined {
  return process.env.SENTINAI_API_KEY || undefined;
}

/**
 * Middleware configuration.
 * - /api/*: API key guard + read-only mode
 * - /.well-known/*: OAuth discovery (intercepted before basePath routing, served at domain root)
 */
export const config = {
  matcher: ['/api/:path*', '/.well-known/:path*'],
};

/**
 * Routes exempt from API key authentication (internal/automated endpoints)
 */
const AUTH_EXEMPT_ROUTES = new Set([
  '/api/health',
  '/api/agent-loop',
  '/api/oauth/token',    // OAuth token endpoint is the auth entry point
  '/api/oauth/register', // DCR endpoint is unauthenticated by definition (RFC 7591)
  '/api/mcp',           // MCP server has its own auth layer (policy engine + Bearer token)
]);

/**
 * Main middleware function
 */
export function middleware(request: NextRequest) {
  // pathname from nextUrl strips basePath; use URL directly for root-level paths
  const rawPathname = new URL(request.url).pathname;

  // Serve OAuth discovery at domain root regardless of basePath
  const wellKnownResponse = handleWellKnown(request, rawPathname);
  if (wellKnownResponse) return wellKnownResponse;

  const { pathname } = request.nextUrl;
  const method = request.method;

  // Always allow exempt routes (health checks, internal automation)
  if (AUTH_EXEMPT_ROUTES.has(pathname)) {
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
        '/api/goals',             // Goal planner (write safety enforced in route)
        '/api/goal-manager/tick', // Goal queue refresh (no infra write)
        '/api/goal-manager/dispatch', // Dry-run dispatch allowed; write blocked in route
        '/api/mcp',               // MCP invocation (write safety enforced in MCP handler)
        '/api/metrics/seed',      // Demo scenario injection (no real infra changes)
        '/api/autonomous/plan',   // Autonomous plan (dry-run, no infra write)
        '/api/autonomous/execute', // Autonomous execute (write safety enforced in handler)
        '/api/autonomous/verify', // Autonomous verify (read-only)
        '/api/autonomous/rollback', // Autonomous rollback (write safety enforced in handler)
      ];

      if (allowScalerWriteInReadOnlyMode()) {
        safeEndpoints.push('/api/scaler');
      }

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
