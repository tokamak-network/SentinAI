/**
 * Middleware auth-guard regression tests.
 *
 * Covers:
 * - GET requests pass through (no API key required)
 * - POST/PATCH/DELETE/PUT require x-api-key when SENTINAI_API_KEY is set
 * - /api/test/* routes are always blocked in production
 * - /api/test/* routes require API key in development when key is configured
 * - AUTH_EXEMPT_ROUTES bypass auth
 * - Fail-closed: production without SENTINAI_API_KEY blocks all writes
 * - Rate limiting: POST /api/nlops and /api/rca are throttled per-IP
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

function makeRequest(method: string, url: string, apiKey?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (apiKey) headers['x-api-key'] = apiKey;
  return new NextRequest(url, { method, headers });
}

async function runMiddleware(req: NextRequest) {
  // Force re-import so env stubs are picked up
  vi.resetModules();
  const { middleware } = await import('./middleware');
  return middleware(req);
}

describe('middleware — GET passthrough', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('allows GET /api/metrics without API key', async () => {
    vi.stubEnv('SENTINAI_API_KEY', 'a-very-strong-api-key-32-characters!!');
    const req = makeRequest('GET', 'http://localhost:3002/api/metrics');
    const res = await runMiddleware(req);
    expect(res.status).not.toBe(401);
  });
});

describe('middleware — API key guard (POST/PATCH/DELETE/PUT)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('rejects POST /api/scaler without x-api-key', async () => {
    vi.stubEnv('SENTINAI_API_KEY', 'a-very-strong-api-key-32-characters!!');
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('POST', 'http://localhost:3002/api/scaler');
    const res = await runMiddleware(req);
    expect(res.status).toBe(401);
  });

  it('allows POST /api/scaler with correct x-api-key', async () => {
    const key = 'a-very-strong-api-key-32-characters!!';
    vi.stubEnv('SENTINAI_API_KEY', key);
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('POST', 'http://localhost:3002/api/scaler', key);
    const res = await runMiddleware(req);
    expect(res.status).not.toBe(401);
  });

  it('rejects POST with wrong x-api-key', async () => {
    vi.stubEnv('SENTINAI_API_KEY', 'a-very-strong-api-key-32-characters!!');
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('POST', 'http://localhost:3002/api/scaler', 'wrong-key');
    const res = await runMiddleware(req);
    expect(res.status).toBe(401);
  });
});

describe('middleware — fail-closed (production, no API key)', () => {
  beforeEach(() => vi.stubEnv('NODE_ENV', 'production'));
  afterEach(() => vi.unstubAllEnvs());

  it('blocks POST when SENTINAI_API_KEY is absent in production', async () => {
    vi.stubEnv('SENTINAI_API_KEY', '');
    const req = makeRequest('POST', 'http://localhost:3002/api/scaler');
    const res = await runMiddleware(req);
    expect(res.status).toBe(401);
  });
});

describe('middleware — /api/test/* production deny-list', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns 404 for GET /api/test/seed-ledger in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SENTINAI_ALLOW_TEST_ROUTES', '');
    const req = makeRequest('GET', 'http://localhost:3002/api/test/seed-ledger');
    const res = await runMiddleware(req);
    expect(res.status).toBe(404);
  });

  it('returns 404 for POST /api/test/demo-scenario in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SENTINAI_ALLOW_TEST_ROUTES', '');
    const key = 'a-very-strong-api-key-32-characters!!';
    vi.stubEnv('SENTINAI_API_KEY', key);
    const req = makeRequest('POST', 'http://localhost:3002/api/test/demo-scenario', key);
    const res = await runMiddleware(req);
    expect(res.status).toBe(404);
  });

  it('allows /api/test/* in production when SENTINAI_ALLOW_TEST_ROUTES=true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SENTINAI_ALLOW_TEST_ROUTES', 'true');
    const key = 'a-very-strong-api-key-32-characters!!';
    vi.stubEnv('SENTINAI_API_KEY', key);
    const req = makeRequest('POST', 'http://localhost:3002/api/test/seed-ledger', key);
    const res = await runMiddleware(req);
    expect(res.status).not.toBe(404);
  });

  it('rejects GET /api/test/* without API key in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const key = 'a-very-strong-api-key-32-characters!!';
    vi.stubEnv('SENTINAI_API_KEY', key);
    // GET without key — test route guard requires API key
    const req = makeRequest('GET', 'http://localhost:3002/api/test/seed-ledger');
    const res = await runMiddleware(req);
    expect(res.status).toBe(401);
  });
});

describe('middleware — AUTH_EXEMPT_ROUTES bypass', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('/api/health is exempt from API key', async () => {
    vi.stubEnv('SENTINAI_API_KEY', 'a-very-strong-api-key-32-characters!!');
    // GET to health (exempt)
    const req = makeRequest('GET', 'http://localhost:3002/api/health');
    const res = await runMiddleware(req);
    expect(res.status).not.toBe(401);
  });
});

describe('middleware — rate limiting', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    // Clear in-process rate limit store between tests
    vi.resetModules();
    const { _clearRateLimitStore } = await import('./middleware');
    _clearRateLimitStore();
  });

  it('allows POST /api/nlops within rate limit', async () => {
    vi.stubEnv('SENTINAI_API_KEY', 'a-very-strong-api-key-32-characters!!');
    const key = 'a-very-strong-api-key-32-characters!!';
    const req = makeRequest('POST', 'http://localhost:3002/api/nlops', key);
    const res = await runMiddleware(req);
    expect(res.status).not.toBe(429);
  });

  it('returns 429 when POST /api/nlops exceeds rate limit', async () => {
    vi.stubEnv('SENTINAI_API_KEY', 'a-very-strong-api-key-32-characters!!');
    const key = 'a-very-strong-api-key-32-characters!!';

    // Exhaust the limit (20 requests per 60s)
    vi.resetModules();
    const { middleware, _clearRateLimitStore } = await import('./middleware');
    _clearRateLimitStore();

    for (let i = 0; i < 20; i++) {
      const req = makeRequest('POST', 'http://localhost:3002/api/nlops', key);
      await middleware(req);
    }

    // 21st request should be throttled
    const req = makeRequest('POST', 'http://localhost:3002/api/nlops', key);
    const res = await middleware(req);
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body).toHaveProperty('retryAfterMs');
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('does NOT rate limit GET /api/nlops', async () => {
    vi.stubEnv('SENTINAI_API_KEY', 'a-very-strong-api-key-32-characters!!');

    vi.resetModules();
    const { middleware, _clearRateLimitStore } = await import('./middleware');
    _clearRateLimitStore();

    // Exhaust POST limit
    const key = 'a-very-strong-api-key-32-characters!!';
    for (let i = 0; i < 20; i++) {
      const req = makeRequest('POST', 'http://localhost:3002/api/nlops', key);
      await middleware(req);
    }

    // GET should still pass through (not rate limited)
    const getReq = makeRequest('GET', 'http://localhost:3002/api/nlops');
    const res = await middleware(getReq);
    expect(res.status).not.toBe(429);
  });

  it('returns 429 when POST /api/rca exceeds rate limit (10 req/min)', async () => {
    vi.stubEnv('SENTINAI_API_KEY', 'a-very-strong-api-key-32-characters!!');
    const key = 'a-very-strong-api-key-32-characters!!';

    vi.resetModules();
    const { middleware, _clearRateLimitStore } = await import('./middleware');
    _clearRateLimitStore();

    for (let i = 0; i < 10; i++) {
      const req = makeRequest('POST', 'http://localhost:3002/api/rca', key);
      await middleware(req);
    }

    const req = makeRequest('POST', 'http://localhost:3002/api/rca', key);
    const res = await middleware(req);
    expect(res.status).toBe(429);
  });
});
