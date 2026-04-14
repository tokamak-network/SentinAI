/**
 * Middleware for API Authentication and Read-Only Mode Protection
 *
 * 1. API Key Guard: When SENTINAI_API_KEY is set, all write operations (POST/PATCH/DELETE/PUT)
 *    require a valid x-api-key header. Internal routes (health, agent-loop) are exempt.
 * 2. Read-Only Mode: When SENTINAI_READ_ONLY_MODE is enabled, blocks write operations
 *    except for whitelisted safe endpoints.
 * 3. OAuth Well-Known: Serves RFC 8414/9728 discovery docs at domain root (bypasses basePath).
 * 4. Rate Limiting: Per-IP sliding window for AI-heavy endpoints (nlops, rca) to limit cost.
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
 * Get configured API key (undefined = auth disabled).
 *
 * Fail-closed in production: if SENTINAI_API_KEY is missing or too short,
 * we return a sentinel value that will never match any request header, so all
 * write operations are blocked rather than passing through unauthenticated.
 *
 * Minimum recommended length: 32 characters.
 */
function getApiKey(): string | undefined {
  const key = process.env.SENTINAI_API_KEY;

  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      // Fail-closed: block all writes when API key is absent in production.
      // A sentinel that can never be matched prevents accidental open access.
      console.error(
        '[middleware] SENTINAI_API_KEY is not set in production. ' +
        'All write operations are blocked. Set a strong API key (min 32 chars).'
      );
      return '__sentinai_no_key_configured__';
    }
    return undefined;
  }

  if (key.length < 32) {
    console.warn(
      '[middleware] SENTINAI_API_KEY is shorter than 32 characters. ' +
      'Use openssl rand -hex 32 to generate a strong key.'
    );
  }

  return key;
}

/**
 * Minimal session token validation at Edge Runtime.
 * Parses token format: satv2_{address}_{issuedAt}_{expiresAt}_{hmac}
 * Checks expiration timestamp only (HMAC verification happens at API Route).
 */
function isValidSessionTokenEdge(token: string): boolean {
  try {
    const parts = token.split('_');
    if (parts.length !== 5 || parts[0] !== 'satv2') return false;

    const expiresAtStr = parts[3];
    const expiresAt = parseInt(expiresAtStr, 10);

    // Check if token is expired
    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

const SESSION_COOKIE_NAME = 'sentinai_admin_session';

// ---------------------------------------------------------------------------
// Per-IP sliding window rate limiter (Edge Runtime compatible, in-process)
// Works correctly in Docker (long-running process). Resets on server restart.
// Map key: "<route-prefix>:<ip>", value: sorted array of request timestamps
// ---------------------------------------------------------------------------
const _rateLimitStore = new Map<string, number[]>();

interface RateLimitRule {
  prefix: string;
  /** Only applies to these HTTP methods (empty = all methods) */
  methods: string[];
  windowMs: number;
  maxRequests: number;
}

/**
 * AI-heavy endpoints — rate limited to protect LLM cost.
 * Limits are intentionally generous; the goal is preventing runaway abuse,
 * not throttling normal use.
 */
const RATE_LIMIT_RULES: RateLimitRule[] = [
  { prefix: '/api/nlops', methods: ['POST'],         windowMs: 60_000, maxRequests: 20 },
  { prefix: '/api/rca',   methods: ['POST'],         windowMs: 60_000, maxRequests: 10 },
];

function checkRateLimit(
  key: string,
  windowMs: number,
  maxRequests: number,
  nowMs: number = Date.now(),
): { allowed: boolean; retryAfterMs: number } {
  const cutoff = nowMs - windowMs;
  const timestamps = (_rateLimitStore.get(key) ?? []).filter((t) => t > cutoff);

  if (timestamps.length >= maxRequests) {
    // timestamps is sorted ascending; oldest entry is at index 0
    const retryAfterMs = Math.max(0, timestamps[0] + windowMs - nowMs);
    return { allowed: false, retryAfterMs };
  }

  timestamps.push(nowMs);
  _rateLimitStore.set(key, timestamps);

  // Periodic GC: evict keys whose entire history has expired
  if (_rateLimitStore.size > 10_000) {
    for (const [k, v] of _rateLimitStore) {
      if (v.every((t) => t <= cutoff)) _rateLimitStore.delete(k);
    }
  }

  return { allowed: true, retryAfterMs: 0 };
}

/** Exposed for unit tests — clears all in-process rate limit state. */
export function _clearRateLimitStore(): void {
  _rateLimitStore.clear();
}

function applyRateLimits(
  request: NextRequest,
  pathname: string,
  method: string,
): NextResponse | null {
  for (const rule of RATE_LIMIT_RULES) {
    if (!pathname.startsWith(rule.prefix)) continue;
    if (rule.methods.length > 0 && !rule.methods.includes(method)) continue;

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
    const key = `rl:${rule.prefix}:${ip}`;
    const result = checkRateLimit(key, rule.windowMs, rule.maxRequests);

    if (!result.allowed) {
      return NextResponse.json(
        {
          error: 'Too many requests',
          retryAfterMs: result.retryAfterMs,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(result.retryAfterMs / 1000)),
          },
        },
      );
    }
  }
  return null;
}

/**
 * Middleware configuration.
 * - /api/*: API key guard + read-only mode
 * - /.well-known/*: OAuth discovery (intercepted before basePath routing, served at domain root)
 * - /v2/marketplace: Session cookie gate for admin access
 */
export const config = {
  matcher: [
    '/api/:path*',
    '/.well-known/:path*',
    '/admin',
    '/admin/:path*',
    '/v2/marketplace',
    '/v2/marketplace/:path*',
  ],
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
  '/api/auth/siwe/nonce',  // SIWE login flow — public by design
  '/api/auth/siwe/verify', // SIWE login flow — public by design
  '/api/auth/siwe/logout', // SIWE logout — session-gated, not API-key-gated
  '/api/admin/auth/logout', // Admin logout — session-gated, not API-key-gated
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

  // --- Layer 0: Session Cookie Gate for Admin Pages ---
  const isProtectedAdminPath =
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/v2/marketplace' ||
    pathname.startsWith('/v2/marketplace/');

  if (isProtectedAdminPath) {
    // Allow /admin/login without session
    if (pathname === '/admin/login') {
      return NextResponse.next();
    }

    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionToken || !isValidSessionTokenEdge(sessionToken)) {
      // Redirect to login with callback URL (preserve basePath via nextUrl.clone)
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/admin/login';
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Always allow exempt routes (health checks, internal automation)
  if (AUTH_EXEMPT_ROUTES.has(pathname)) {
    return NextResponse.next();
  }

  // --- Rate limiting: AI-heavy endpoints (protect LLM cost) ---
  const rateLimitResponse = applyRateLimits(request, pathname, method);
  if (rateLimitResponse) return rateLimitResponse;

  // --- Test-route guard: /api/test/* always requires authentication (defense-in-depth) ---
  // These endpoints bypass the GET-passthrough below because they can mutate state.
  if (pathname.startsWith('/api/test/')) {
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.SENTINAI_ALLOW_TEST_ROUTES !== 'true'
    ) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // In non-production, still require API key for any write-capable test route
    const apiKey = getApiKey();
    if (apiKey) {
      const providedKey = request.headers.get('x-api-key');
      if (providedKey !== apiKey) {
        return NextResponse.json(
          { error: 'Unauthorized: invalid or missing x-api-key' },
          { status: 401 }
        );
      }
    }
    return NextResponse.next();
  }

  // CORS: agent-marketplace endpoints are public APIs called from external browser origins
  if (pathname.startsWith('/api/agent-marketplace/')) {
    if (method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-payment',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    const response = NextResponse.next();
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-payment');
    return response;
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
