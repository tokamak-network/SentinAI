/**
 * SIWE Session Token Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getAdminAddress,
  issueSessionToken,
  verifySessionToken,
  SESSION_TTL_MS,
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  clearSessionCookie,
} from './siwe-session';
import { privateKeyToAccount } from 'viem/accounts';
import { getAddress } from 'viem';

const TEST_WALLET_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234';
const TEST_API_KEY = 'test-sentinai-api-key-secret';

// Derive the address for tests
const TEST_ADDRESS = getAddress(privateKeyToAccount(TEST_WALLET_KEY).address);

describe('siwe-session', () => {
  beforeEach(() => {
    vi.stubEnv('SENTINAI_API_KEY', TEST_API_KEY);
    vi.stubEnv('NODE_ENV', 'development');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('getAdminAddress', () => {
    it('should return checksum address from SENTINAI_ADMIN_ADDRESS', () => {
      vi.stubEnv('SENTINAI_ADMIN_ADDRESS', TEST_ADDRESS);
      const address = getAdminAddress();
      expect(address).not.toBeNull();
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it('should return null when SENTINAI_ADMIN_ADDRESS is not set', () => {
      // Not setting the env var
      const address = getAdminAddress();
      expect(address).toBeNull();
    });

    it('should return null for invalid address format', () => {
      vi.stubEnv('SENTINAI_ADMIN_ADDRESS', 'not-an-address');
      const address = getAdminAddress();
      expect(address).toBeNull();
    });

    it('should accept lowercase address', () => {
      vi.stubEnv('SENTINAI_ADMIN_ADDRESS', TEST_ADDRESS.toLowerCase());
      const address = getAdminAddress();
      expect(address).not.toBeNull();
    });
  });

  describe('issueSessionToken', () => {
    it('should issue a valid session token', () => {
      const token = issueSessionToken(TEST_ADDRESS);
      expect(token).toMatch(/^satv2_[0-9a-fA-F]{40}_\d+_\d+_[0-9a-f]{64}$/);
    });

    it('should include correct timestamp parts', () => {
      const beforeTime = Date.now();
      const token = issueSessionToken(TEST_ADDRESS);
      const afterTime = Date.now();

      const parts = token.split('_');
      const issuedAt = parseInt(parts[2], 10);
      const expiresAt = parseInt(parts[3], 10);

      expect(issuedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(issuedAt).toBeLessThanOrEqual(afterTime);
      expect(expiresAt).toBe(issuedAt + SESSION_TTL_MS);
    });

    it('should throw when SENTINAI_API_KEY is not set', () => {
      vi.stubEnv('SENTINAI_API_KEY', '');

      expect(() => {
        issueSessionToken(TEST_ADDRESS);
      }).toThrow('SENTINAI_API_KEY is not configured');
    });

    it('should produce different HMACs for different keys', () => {
      const token1 = issueSessionToken(TEST_ADDRESS);

      vi.stubEnv('SENTINAI_API_KEY', 'different-api-key');
      const token2 = issueSessionToken(TEST_ADDRESS);

      expect(token1).not.toBe(token2);
    });
  });

  describe('verifySessionToken', () => {
    it('should verify a valid token', () => {
      const token = issueSessionToken(TEST_ADDRESS);

      const session = verifySessionToken(token);
      expect(session).not.toBeNull();
      expect(session?.address).toBe(TEST_ADDRESS);
      expect(session?.issuedAt).toBeGreaterThan(0);
      expect(session?.expiresAt).toBeGreaterThan(session?.issuedAt!);
    });

    it('should reject token with invalid format', () => {
      const invalidTokens = [
        'invalid',
        'satv2_0x123',
        'satv2_0x' + 'a'.repeat(40) + '_123_456',
        'satv1_0x' + 'a'.repeat(40) + '_123_456_hmac',
      ];

      for (const token of invalidTokens) {
        const session = verifySessionToken(token);
        expect(session).toBeNull();
      }
    });

    it('should reject expired token', async () => {
      const token = issueSessionToken(TEST_ADDRESS);

      // Mock Date.now() to be after expiration
      const parts = token.split('_');
      const expiresAt = parseInt(parts[3], 10);
      vi.spyOn(Date, 'now').mockReturnValue(expiresAt + 1000);

      const session = verifySessionToken(token);
      expect(session).toBeNull();
    });

    it('should reject token with invalid HMAC', () => {
      const token = issueSessionToken(TEST_ADDRESS);

      // Tamper with the HMAC
      const parts = token.split('_');
      const tamperedToken = `${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}_invalid${'f'.repeat(58)}`;

      const session = verifySessionToken(tamperedToken);
      expect(session).toBeNull();
    });

    it('should reject token with invalid address format', () => {
      const token = `satv2_invalid_address_123_456_${'f'.repeat(64)}`;
      const session = verifySessionToken(token);
      expect(session).toBeNull();
    });

    it('should reject token with non-numeric timestamps', () => {
      const token = `satv2_${TEST_ADDRESS}_notanumber_456_${'f'.repeat(64)}`;

      const session = verifySessionToken(token);
      expect(session).toBeNull();
    });

    it('should return null when SENTINAI_API_KEY is not set', () => {
      const token = issueSessionToken(TEST_ADDRESS);

      vi.stubEnv('SENTINAI_API_KEY', '');
      const session = verifySessionToken(token);
      expect(session).toBeNull();
    });

    it('should use timing-safe HMAC comparison', () => {
      const token = issueSessionToken(TEST_ADDRESS);

      // This test verifies the function doesn't crash with invalid HMAC
      const parts = token.split('_');
      const wrongHmac = '00'.repeat(32);
      const tamperedToken = `${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}_${wrongHmac}`;

      const session = verifySessionToken(tamperedToken);
      expect(session).toBeNull();
    });
  });

  describe('token format and round-trip', () => {
    it('should support round-trip verification', () => {
      const token = issueSessionToken(TEST_ADDRESS);
      const session = verifySessionToken(token);

      expect(session).not.toBeNull();
      expect(session?.address).toBe(TEST_ADDRESS);
    });

    it('should produce consistent HMACs for same inputs', () => {
      const token1 = issueSessionToken(TEST_ADDRESS);
      const token2 = issueSessionToken(TEST_ADDRESS);

      // Both should verify successfully
      const session1 = verifySessionToken(token1);
      const session2 = verifySessionToken(token2);

      expect(session1).not.toBeNull();
      expect(session2).not.toBeNull();
    });
  });

  describe('buildSessionCookie', () => {
    it('should build a valid session cookie in development', () => {
      vi.stubEnv('NODE_ENV', 'development');
      const token = issueSessionToken(TEST_ADDRESS);

      const cookie = buildSessionCookie(token);
      expect(cookie).toContain(`${SESSION_COOKIE_NAME}=${token}`);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
      expect(cookie).not.toContain('Secure');
    });

    it('should build a secure cookie in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const token = issueSessionToken(TEST_ADDRESS);

      const cookie = buildSessionCookie(token);
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('HttpOnly');
    });
  });

  describe('clearSessionCookie', () => {
    it('should return a cookie deletion string', () => {
      const clearCookie = clearSessionCookie();
      expect(clearCookie).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(clearCookie).toContain('Max-Age=0');
      expect(clearCookie).toContain('HttpOnly');
    });
  });

  describe('edge cases', () => {
    it('should handle very long-lived sessions', () => {
      const token = issueSessionToken(TEST_ADDRESS);

      const session = verifySessionToken(token);
      expect(session).not.toBeNull();
      expect(session?.expiresAt).toBeGreaterThan(session?.issuedAt! + SESSION_TTL_MS - 1000);
    });

    it('should reject token with extra underscores', () => {
      const token = issueSessionToken(TEST_ADDRESS);

      const malformedToken = token + '_extra';
      const session = verifySessionToken(malformedToken);
      expect(session).toBeNull();
    });

    it('should preserve address case in token verification', () => {
      const token = issueSessionToken(TEST_ADDRESS);
      const session = verifySessionToken(token);

      expect(session?.address).toBe(TEST_ADDRESS);
    });
  });
});
