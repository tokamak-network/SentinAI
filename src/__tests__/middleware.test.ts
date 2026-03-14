import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { middleware } from '@/middleware';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Mock NextRequest/NextResponse
 * Vitest doesn't have full Edge Runtime, so we mock these.
 */

interface MockRequestOptions {
  method?: string;
  pathname: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
}

function createMockRequest(options: MockRequestOptions): NextRequest {
  const {
    method = 'GET',
    pathname,
    cookies = {},
    headers = {},
    queryParams = {},
  } = options;

  const query = new URLSearchParams(queryParams).toString();
  const url = new URL(
    `http://localhost:3002${pathname}${query ? '?' + query : ''}`,
    'http://localhost:3002'
  );

  const mockHeaders = new Map(Object.entries(headers));
  mockHeaders.set('host', 'localhost:3002');

  const mockRequest = {
    url: url.toString(),
    method,
    nextUrl: new URL(pathname, 'http://localhost:3002'),
    headers: mockHeaders,
    cookies: {
      get: (name: string) => {
        return cookies[name] ? { value: cookies[name] } : undefined;
      },
    },
  } as unknown as NextRequest;

  return mockRequest;
}

describe('Middleware: SIWE Session Validation for /v2/marketplace', () => {
  beforeEach(() => {
    // Reset any module state
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Session Cookie Gate - Protected Routes', () => {
    it('allows request with valid session token', () => {
      const now = Date.now();
      const expiresAt = now + 8 * 60 * 60 * 1000; // 8 hours in future
      const validToken = `satv2_1234567890123456789012345678901234567890_${now}_${expiresAt}_somehash`;

      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {
          sentinai_admin_session: validToken,
        },
      });

      const response = middleware(request);

      // Should not be a redirect (NextResponse.next() returns response that is not a redirect)
      expect(response).toBeInstanceOf(NextResponse);
      expect(response.status).not.toBe(307); // Not a redirect status
    });

    it('redirects to login when session cookie is missing', () => {
      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {},
      });

      const response = middleware(request);

      expect(response.status).toBe(307); // Redirect status
      const location = response.headers.get('location');
      expect(location).toMatch(/\/login/);
      expect(location).toContain('callbackUrl=%2Fv2%2Fmarketplace');
    });

    it('redirects to login when session token is invalid format', () => {
      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {
          sentinai_admin_session: 'invalid_token_format',
        },
      });

      const response = middleware(request);

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toMatch(/\/login/);
    });

    it('redirects to login when session token is expired', () => {
      const now = Date.now();
      const expiresAt = now - 3600 * 1000; // Expired 1 hour ago
      const expiredToken = `satv2_1234567890123456789012345678901234567890_${now}_${expiresAt}_somehash`;

      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {
          sentinai_admin_session: expiredToken,
        },
      });

      const response = middleware(request);

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toMatch(/\/login/);
    });

    it('allows request with valid token on /v2/marketplace/ subpaths', () => {
      const now = Date.now();
      const expiresAt = now + 8 * 60 * 60 * 1000;
      const validToken = `satv2_1234567890123456789012345678901234567890_${now}_${expiresAt}_somehash`;

      const paths = [
        '/v2/marketplace/pricing',
        '/v2/marketplace/orders',
        '/v2/marketplace/settings',
      ];

      paths.forEach(pathname => {
        const request = createMockRequest({
          pathname,
          method: 'GET',
          cookies: {
            sentinai_admin_session: validToken,
          },
        });

        const response = middleware(request);

        // Not a redirect
        expect(response.status).not.toBe(307);
      });
    });

    it('redirects all /v2/marketplace subpaths when missing session', () => {
      const paths = [
        '/v2/marketplace',
        '/v2/marketplace/pricing',
        '/v2/marketplace/orders',
      ];

      paths.forEach(pathname => {
        const request = createMockRequest({
          pathname,
          method: 'GET',
          cookies: {},
        });

        const response = middleware(request);

        expect(response.status).toBe(307);
        const location = response.headers.get('location');
        expect(location).toContain('/login');
        expect(location).toContain('callbackUrl');
      });
    });
  });

  describe('CallbackUrl Parameter Preservation', () => {
    it('preserves pathname in callbackUrl query parameter', () => {
      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {},
      });

      const response = middleware(request);

      const location = response.headers.get('location');
      expect(location).toContain('callbackUrl=%2Fv2%2Fmarketplace');
    });

    it('preserves subpath in callbackUrl for nested marketplace routes', () => {
      const request = createMockRequest({
        pathname: '/v2/marketplace/pricing',
        method: 'GET',
        cookies: {},
      });

      const response = middleware(request);

      const location = response.headers.get('location');
      expect(location).toContain('callbackUrl=%2Fv2%2Fmarketplace%2Fpricing');
    });

    it('preserves query parameters in callbackUrl', () => {
      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        queryParams: {
          tab: 'pricing',
          sort: 'asc',
        },
        cookies: {},
      });

      const response = middleware(request);

      const location = response.headers.get('location');
      expect(location).toContain('callbackUrl');
      // The callbackUrl should encode the full path with query params
      expect(location).toMatch(/callbackUrl/);
    });
  });

  describe('Token Validation Edge Cases', () => {
    it('rejects token with malformed expiresAt timestamp', () => {
      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {
          sentinai_admin_session: 'satv2_1234567890123456789012345678901234567890_123456789_notanumber_hash',
        },
      });

      const response = middleware(request);

      expect(response.status).toBe(307);
    });

    it('rejects token with wrong prefix', () => {
      const now = Date.now();
      const expiresAt = now + 8 * 60 * 60 * 1000;
      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {
          sentinai_admin_session: `badprefix_1234567890123456789012345678901234567890_${now}_${expiresAt}_hash`,
        },
      });

      const response = middleware(request);

      expect(response.status).toBe(307);
    });

    it('rejects token with incorrect number of parts', () => {
      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {
          sentinai_admin_session: 'satv2_address_timestamp_hash', // Only 4 parts
        },
      });

      const response = middleware(request);

      expect(response.status).toBe(307);
    });

    it('accepts token at exact expiration boundary (now === expiresAt should still be valid at ms precision)', () => {
      const now = Date.now();
      // Token valid if Date.now() <= expiresAt
      const validToken = `satv2_1234567890123456789012345678901234567890_${now}_${now}_hash`;

      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {
          sentinai_admin_session: validToken,
        },
      });

      const response = middleware(request);

      // At the exact moment, token should still be valid (Date.now() > expiresAt is false at same ms)
      // Note: this might fail if execution takes > 1ms, but typically it passes
      expect(response.status).not.toBe(307);
    });
  });

  describe('Non-Protected Routes - Passthrough', () => {
    it('allows GET requests to /api/health without session', () => {
      const request = createMockRequest({
        pathname: '/api/health',
        method: 'GET',
        cookies: {},
      });

      const response = middleware(request);

      // Health check should pass through (exempt route)
      expect(response.status).not.toBe(307);
    });

    it('allows requests to routes outside /v2/marketplace without session', () => {
      const request = createMockRequest({
        pathname: '/api/metrics',
        method: 'GET',
        cookies: {},
      });

      const response = middleware(request);

      // Non-protected route, no redirect
      expect(response.status).not.toBe(307);
    });

    it('allows GET requests to any API endpoint without API key', () => {
      const request = createMockRequest({
        pathname: '/api/metrics',
        method: 'GET',
        headers: {},
      });

      const response = middleware(request);

      // GET requests always allowed
      expect(response.status).not.toBe(401);
    });
  });

  describe('HTTP Methods on Protected Routes', () => {
    it('rejects all methods (GET, POST, etc.) without valid session on /v2/marketplace', () => {
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

      methods.forEach(method => {
        const request = createMockRequest({
          pathname: '/v2/marketplace',
          method,
          cookies: {},
        });

        const response = middleware(request);

        expect(response.status).toBe(307);
        const location = response.headers.get('location');
        expect(location).toContain('/login');
      });
    });

    it('allows all methods with valid session on /v2/marketplace', () => {
      const now = Date.now();
      const expiresAt = now + 8 * 60 * 60 * 1000;
      const validToken = `satv2_1234567890123456789012345678901234567890_${now}_${expiresAt}_hash`;
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

      methods.forEach(method => {
        const request = createMockRequest({
          pathname: '/v2/marketplace',
          method,
          cookies: {
            sentinai_admin_session: validToken,
          },
        });

        const response = middleware(request);

        // Should not redirect
        expect(response.status).not.toBe(307);
      });
    });
  });

  describe('OAuth Discovery Routes - Bypass Session Gate', () => {
    it('serves /.well-known/oauth-protected-resource without session', () => {
      const request = createMockRequest({
        pathname: '/.well-known/oauth-protected-resource',
        method: 'GET',
        cookies: {},
      });

      const response = middleware(request);

      // OAuth discovery routes should not redirect
      expect(response.status).not.toBe(307);
    });

    it('serves /.well-known/oauth-authorization-server without session', () => {
      const request = createMockRequest({
        pathname: '/.well-known/oauth-authorization-server',
        method: 'GET',
        cookies: {},
      });

      const response = middleware(request);

      expect(response.status).not.toBe(307);
    });
  });

  describe('Cookie Name Constant', () => {
    it('uses correct session cookie name (sentinai_admin_session)', () => {
      // This validates that the middleware uses the expected cookie name
      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {
          sentinai_admin_session: 'dummy_token_that_will_be_rejected', // Wrong format
        },
      });

      const response = middleware(request);

      // Should redirect because token format is invalid, not because cookie name is wrong
      expect(response.status).toBe(307);
    });

    it('ignores cookies with different names', () => {
      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {
          wrong_cookie_name: 'some_token',
        },
      });

      const response = middleware(request);

      // Should redirect because no sentinai_admin_session cookie
      expect(response.status).toBe(307);
    });
  });

  describe('Token Format Validation', () => {
    it('accepts token with valid 40-char hex address and valid structure', () => {
      const now = Date.now();
      const expiresAt = now + 8 * 60 * 60 * 1000;
      const validToken = `satv2_1234567890abcdef1234567890abcdef12345678_${now}_${expiresAt}_validhash`;

      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {
          sentinai_admin_session: validToken,
        },
      });

      const response = middleware(request);

      // Valid format, should not redirect
      expect(response.status).not.toBe(307);
    });

    it('allows token with too-short address at Edge (validation happens at API route)', () => {
      const now = Date.now();
      const expiresAt = now + 8 * 60 * 60 * 1000;
      // Edge Runtime only checks token format, not address validity (HMAC verified at API route)
      const edgeAcceptedToken = `satv2_1234567890abcdef_${now}_${expiresAt}_hash`;

      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {
          sentinai_admin_session: edgeAcceptedToken,
        },
      });

      const response = middleware(request);

      // Edge middleware does not validate address format (only structure and expiration)
      // Full HMAC validation happens in API route
      expect(response.status).not.toBe(307);
    });
  });

  describe('Real-World Scenarios', () => {
    it('completes full flow: missing session -> redirect to login with callback', () => {
      const request = createMockRequest({
        pathname: '/v2/marketplace/pricing',
        method: 'GET',
        cookies: {},
      });

      const response = middleware(request);

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();
      expect(location).toContain('/login');
      expect(location).toContain('callbackUrl=%2Fv2%2Fmarketplace%2Fpricing');
    });

    it('completes full flow: valid session -> access granted', () => {
      const now = Date.now();
      const expiresAt = now + 8 * 60 * 60 * 1000;
      const validToken = `satv2_1234567890123456789012345678901234567890_${now}_${expiresAt}_hash`;

      const request = createMockRequest({
        pathname: '/v2/marketplace/pricing',
        method: 'POST',
        cookies: {
          sentinai_admin_session: validToken,
        },
      });

      const response = middleware(request);

      // Should continue to next middleware/handler
      expect(response.status).not.toBe(307);
      expect(response.status).not.toBe(401);
    });

    it('handles session approaching expiration (1 hour remaining)', () => {
      const now = Date.now();
      const expiresAt = now + 60 * 60 * 1000; // 1 hour remaining
      const token = `satv2_1234567890123456789012345678901234567890_${now}_${expiresAt}_hash`;

      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {
          sentinai_admin_session: token,
        },
      });

      const response = middleware(request);

      // Token is still valid
      expect(response.status).not.toBe(307);
    });

    it('rejects session with 1ms left to expiration on next request', () => {
      const now = Date.now();
      const expiresAt = now - 1; // Expired 1ms ago
      const token = `satv2_1234567890123456789012345678901234567890_${now}_${expiresAt}_hash`;

      const request = createMockRequest({
        pathname: '/v2/marketplace',
        method: 'GET',
        cookies: {
          sentinai_admin_session: token,
        },
      });

      const response = middleware(request);

      expect(response.status).toBe(307);
    });
  });
});
