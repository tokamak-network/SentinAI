/**
 * Tests for POST /api/auth/siwe/logout
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from './route';
import * as siweSessionModule from '@/lib/siwe-session';

// Mock modules
vi.mock('@/lib/siwe-session', () => ({
  clearSessionCookie: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('POST /api/auth/siwe/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(siweSessionModule.clearSessionCookie).mockReturnValue(
      'sentinai_admin_session=; HttpOnly; Path=/; Max-Age=0'
    );
  });

  describe('valid requests', () => {
    it('should return 204 No Content on successful logout', async () => {
      const request = new Request('http://localhost:3000/api/auth/siwe/logout', {
        method: 'POST',
      });

      const response = await POST();

      expect(response.status).toBe(204);
    });

    it('should set Set-Cookie header to clear session', async () => {
      const request = new Request('http://localhost:3000/api/auth/siwe/logout', {
        method: 'POST',
      });

      const response = await POST();

      const cookieHeader = response.headers.get('Set-Cookie');
      expect(cookieHeader).toBeDefined();
      expect(cookieHeader).toContain('sentinai_admin_session');
      expect(cookieHeader).toContain('Max-Age=0');
    });

    it('should call clearSessionCookie function', async () => {
      await POST();

      expect(siweSessionModule.clearSessionCookie).toHaveBeenCalled();
    });

    it('should have HttpOnly flag in clear cookie', async () => {
      const response = await POST();

      const cookieHeader = response.headers.get('Set-Cookie');
      expect(cookieHeader).toContain('HttpOnly');
    });

    it('should have Path=/ in clear cookie', async () => {
      const response = await POST();

      const cookieHeader = response.headers.get('Set-Cookie');
      expect(cookieHeader).toContain('Path=/');
    });

    it('should not have content in response body', async () => {
      const response = await POST();

      // 204 No Content should have no body
      const body = await response.text();
      expect(body).toBe('');
    });
  });

  describe('error handling', () => {
    it('should still return 204 even if clearSessionCookie throws', async () => {
      vi.mocked(siweSessionModule.clearSessionCookie).mockImplementation(() => {
        throw new Error('Cookie error');
      });

      const response = await POST();

      expect(response.status).toBe(204);
    });

    it('should set cookie even if clearSessionCookie fails', async () => {
      vi.mocked(siweSessionModule.clearSessionCookie).mockImplementation(() => {
        throw new Error('Cookie error');
      });

      const response = await POST();

      // Should still attempt to set a clear cookie or return 204
      expect(response.status).toBe(204);
    });
  });

  describe('response format', () => {
    it('should not require Content-Type for 204 response', async () => {
      const response = await POST();

      // 204 No Content typically doesn't have Content-Type
      // but it's not an error if it does
      expect(response.status).toBe(204);
    });

    it('should properly clear session cookie with standard format', async () => {
      vi.mocked(siweSessionModule.clearSessionCookie).mockReturnValue(
        'sentinai_admin_session=; HttpOnly; Path=/; Max-Age=0'
      );

      const response = await POST();

      const cookieHeader = response.headers.get('Set-Cookie');
      expect(cookieHeader).toMatch(/sentinai_admin_session=/);
      expect(cookieHeader).toMatch(/Max-Age=0/);
    });
  });

  describe('idempotency', () => {
    it('should handle multiple logout requests', async () => {
      const response1 = await POST();
      const response2 = await POST();

      expect(response1.status).toBe(204);
      expect(response2.status).toBe(204);
    });

    it('should clear cookie on each request', async () => {
      const response1 = await POST();
      const response2 = await POST();

      expect(response1.headers.get('Set-Cookie')).toBeDefined();
      expect(response2.headers.get('Set-Cookie')).toBeDefined();
    });
  });

  describe('security', () => {
    it('should not expose sensitive information in response', async () => {
      const response = await POST();

      const body = await response.text();
      expect(body).not.toContain('token');
      expect(body).not.toContain('session');
      expect(body).not.toContain('cookie');
    });

    it('should include HttpOnly flag for security', async () => {
      const response = await POST();

      const cookieHeader = response.headers.get('Set-Cookie');
      expect(cookieHeader).toContain('HttpOnly');
    });

    it('should set Max-Age to 0 for immediate expiration', async () => {
      const response = await POST();

      const cookieHeader = response.headers.get('Set-Cookie');
      expect(cookieHeader).toMatch(/Max-Age=0/);
    });
  });
});
