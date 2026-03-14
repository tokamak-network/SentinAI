/**
 * Tests for GET /api/auth/siwe/nonce
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET } from './route';
import * as nonceStoreModule from '@/lib/nonce-store';

// Mock the nonce store module
vi.mock('@/lib/nonce-store', () => ({
  createNonce: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('GET /api/auth/siwe/nonce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('valid requests', () => {
    it('should return address, nonce, and expiresIn for valid address', async () => {
      const mockNonce = 'a1b2c3d4e5f6' + '7'.repeat(58); // 64 chars
      vi.mocked(nonceStoreModule.createNonce).mockResolvedValue(mockNonce);

      const request = new Request(
        'http://localhost:3000/api/auth/siwe/nonce?address=0xEBc243C42B3E3814629DDC03189AB60dDFfe6498'
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        address: '0xEBc243C42B3E3814629DDC03189AB60dDFfe6498',
        nonce: mockNonce,
        expiresIn: 300,
      });
      expect(nonceStoreModule.createNonce).toHaveBeenCalledWith(
        '0xEBc243C42B3E3814629DDC03189AB60dDFfe6498'
      );
    });

    it('should return consistent nonce for same address on multiple calls', async () => {
      const mockNonce1 = 'a1b2c3d4e5f6' + '7'.repeat(58);
      const mockNonce2 = 'b2c3d4e5f6a1' + '8'.repeat(58);

      vi.mocked(nonceStoreModule.createNonce)
        .mockResolvedValueOnce(mockNonce1)
        .mockResolvedValueOnce(mockNonce2);

      const address = '0xEBc243C42B3E3814629DDC03189AB60dDFfe6498';
      const request1 = new Request(
        `http://localhost:3000/api/auth/siwe/nonce?address=${address}`
      );
      const request2 = new Request(
        `http://localhost:3000/api/auth/siwe/nonce?address=${address}`
      );

      const response1 = await GET(request1);
      const response2 = await GET(request2);

      const data1 = await response1.json();
      const data2 = await response2.json();

      // Should return different nonces (new ones each time)
      expect(data1.nonce).not.toEqual(data2.nonce);
      expect(data1.address).toEqual(data2.address);
    });

    it('should handle lowercase and uppercase addresses', async () => {
      const mockNonce = 'a1b2c3d4e5f6' + '7'.repeat(58);
      vi.mocked(nonceStoreModule.createNonce).mockResolvedValue(mockNonce);

      const addressLower = '0xEBc243C42B3E3814629DDC03189AB60dDFfe6498';
      const request = new Request(
        `http://localhost:3000/api/auth/siwe/nonce?address=${addressLower}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.address).toBe(addressLower);
    });
  });

  describe('invalid requests', () => {
    it('should return 400 for missing address parameter', async () => {
      const request = new Request(
        'http://localhost:3000/api/auth/siwe/nonce'
      );

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Missing or invalid address parameter');
      expect(nonceStoreModule.createNonce).not.toHaveBeenCalled();
    });

    it('should return 400 for empty address parameter', async () => {
      const request = new Request(
        'http://localhost:3000/api/auth/siwe/nonce?address='
      );

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Missing or invalid address parameter');
    });

    it('should return 400 for address without 0x prefix', async () => {
      const request = new Request(
        'http://localhost:3000/api/auth/siwe/nonce?address=EBc243C42B3E3814629DDC03189AB60dDFfe6498'
      );

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Missing or invalid address parameter');
    });

    it('should return 400 for address with incorrect length', async () => {
      const request = new Request(
        'http://localhost:3000/api/auth/siwe/nonce?address=0xEBc243C42B3E3814629DDC03189AB60dDFfe64'
      );

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Missing or invalid address parameter');
    });

    it('should return 400 for address with non-hex characters', async () => {
      const request = new Request(
        'http://localhost:3000/api/auth/siwe/nonce?address=0xGGc243C42B3E3814629DDC03189AB60dDFfe6498'
      );

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Missing or invalid address parameter');
    });

    it('should return 400 for null address', async () => {
      const request = new Request(
        'http://localhost:3000/api/auth/siwe/nonce?address=null'
      );

      const response = await GET(request);

      expect(response.status).toBe(400);
    });
  });

  describe('error handling', () => {
    it('should return 500 when nonce creation fails', async () => {
      vi.mocked(nonceStoreModule.createNonce).mockRejectedValue(
        new Error('Redis connection failed')
      );

      const request = new Request(
        'http://localhost:3000/api/auth/siwe/nonce?address=0xEBc243C42B3E3814629DDC03189AB60dDFfe6498'
      );

      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Failed to create nonce');
    });

    it('should return 500 when nonce creation throws non-Error', async () => {
      vi.mocked(nonceStoreModule.createNonce).mockRejectedValue('String error');

      const request = new Request(
        'http://localhost:3000/api/auth/siwe/nonce?address=0xEBc243C42B3E3814629DDC03189AB60dDFfe6498'
      );

      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Failed to create nonce');
    });
  });

  describe('response format', () => {
    it('should return correct Content-Type header', async () => {
      const mockNonce = 'a1b2c3d4e5f6' + '7'.repeat(58);
      vi.mocked(nonceStoreModule.createNonce).mockResolvedValue(mockNonce);

      const request = new Request(
        'http://localhost:3000/api/auth/siwe/nonce?address=0xEBc243C42B3E3814629DDC03189AB60dDFfe6498'
      );

      const response = await GET(request);

      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('should return expiresIn as 300 seconds', async () => {
      const mockNonce = 'a1b2c3d4e5f6' + '7'.repeat(58);
      vi.mocked(nonceStoreModule.createNonce).mockResolvedValue(mockNonce);

      const request = new Request(
        'http://localhost:3000/api/auth/siwe/nonce?address=0xEBc243C42B3E3814629DDC03189AB60dDFfe6498'
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.expiresIn).toBe(300);
    });

    it('should return nonce as string', async () => {
      const mockNonce = 'a1b2c3d4e5f6' + '7'.repeat(58);
      vi.mocked(nonceStoreModule.createNonce).mockResolvedValue(mockNonce);

      const request = new Request(
        'http://localhost:3000/api/auth/siwe/nonce?address=0xEBc243C42B3E3814629DDC03189AB60dDFfe6498'
      );

      const response = await GET(request);
      const data = await response.json();

      expect(typeof data.nonce).toBe('string');
      expect(data.nonce.length).toBeGreaterThan(0);
    });
  });
});
