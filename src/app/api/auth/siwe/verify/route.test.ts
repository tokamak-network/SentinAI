/**
 * Tests for POST /api/auth/siwe/verify
 * Tests focus on input validation and error handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from './route';
import * as nonceStoreModule from '@/lib/nonce-store';
import * as siweSessionModule from '@/lib/siwe-session';
import * as viemModule from 'viem';

// Mock modules
vi.mock('@/lib/nonce-store', () => ({
  consumeNonce: vi.fn(),
}));

vi.mock('@/lib/siwe-session', () => ({
  getAdminAddress: vi.fn(),
  issueSessionToken: vi.fn(),
  buildSessionCookie: vi.fn(),
}));

vi.mock('viem', () => ({
  verifyMessage: vi.fn(),
  getAddress: vi.fn((addr: string) => addr),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const VALID_ADDRESS = '0xebc243c42b3e3814629ddc03189ab60ddfffe6498';
const ADMIN_ADDRESS = '0xebc243c42b3e3814629ddc03189ab60ddfffe6498';
const NONCE = 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234567';
const VALID_SIGNATURE = '0x' + 'a'.repeat(130);

const VALID_MESSAGE = `wallet.sentinai.io wants you to sign in with your Ethereum account:
${VALID_ADDRESS}

Version: 1
Chain ID: 1
Nonce: ${NONCE}
Issued At: 2024-03-15T10:30:00Z`;

// Helper function to create request with proper body handling
function createRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/auth/siwe/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/siwe/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(nonceStoreModule.consumeNonce).mockResolvedValue(true);
    vi.mocked(viemModule.verifyMessage).mockResolvedValue(true);
    vi.mocked(siweSessionModule.getAdminAddress).mockReturnValue(ADMIN_ADDRESS as `0x${string}`);
    vi.mocked(siweSessionModule.issueSessionToken).mockReturnValue('satv2_token_123');
    vi.mocked(siweSessionModule.buildSessionCookie).mockReturnValue(
      'sentinai_admin_session=satv2_token_123; HttpOnly; Path=/; Max-Age=28800'
    );
    vi.mocked(viemModule.getAddress).mockImplementation((addr) => addr as `0x${string}`);
  });

  describe('address validation', () => {
    it('should return 400 for invalid address format', async () => {
      const request = createRequest({
        address: 'not_an_address',
        signature: VALID_SIGNATURE,
        message: VALID_MESSAGE,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid request');
    });

    it('should return 400 for address with incorrect length', async () => {
      const request = createRequest({
        address: '0x123abc',
        signature: VALID_SIGNATURE,
        message: VALID_MESSAGE,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing address', async () => {
      const request = createRequest({
        signature: VALID_SIGNATURE,
        message: VALID_MESSAGE,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });
  });

  describe('signature validation', () => {
    it('should return 400 for invalid signature format', async () => {
      const request = createRequest({
        address: VALID_ADDRESS,
        signature: 'invalid_signature',
        message: VALID_MESSAGE,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for signature with incorrect length', async () => {
      const request = createRequest({
        address: VALID_ADDRESS,
        signature: '0xabc',
        message: VALID_MESSAGE,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing signature', async () => {
      const request = createRequest({
        address: VALID_ADDRESS,
        message: VALID_MESSAGE,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });
  });

  describe('message validation', () => {
    it('should return 400 for message without nonce', async () => {
      const messageWithoutNonce = VALID_MESSAGE.replace(/Nonce: .*\n/, '');

      const request = createRequest({
        address: VALID_ADDRESS,
        signature: VALID_SIGNATURE,
        message: messageWithoutNonce,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid request');
    });

    it('should return 400 for non-string message', async () => {
      const request = createRequest({
        address: VALID_ADDRESS,
        signature: VALID_SIGNATURE,
        message: 12345,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing message', async () => {
      const request = createRequest({
        address: VALID_ADDRESS,
        signature: VALID_SIGNATURE,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });
  });

  describe('JSON parsing', () => {
    it('should return 400 for invalid JSON body', async () => {
      const request = new Request('http://localhost:3000/api/auth/siwe/verify', {
        method: 'POST',
        body: 'invalid json',
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });
  });

  describe('response headers', () => {
    it('should set Content-Type header for error responses', async () => {
      const request = createRequest({
        address: 'invalid',
        signature: 'invalid',
        message: 'invalid',
      });

      const response = await POST(request);

      expect(response.headers.get('Content-Type')).toContain('application/json');
    });
  });
});
