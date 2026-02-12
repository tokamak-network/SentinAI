/**
 * Tests for EOA Detector
 * Tests auto-detection of batcher/proposer EOAs from L1 transactions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectOrUseManualEOA,
  getEOAAddressWithAutoDetect,
} from '@/lib/eoa-detector';

// Mock viem
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(),
  };
});

vi.mock('@/lib/l1-rpc-failover', () => ({
  getActiveL1RpcUrl: vi.fn(() => 'http://localhost:8545'),
}));

describe('EOA Detector', () => {
  beforeEach(() => {
    // Clear environment variables before each test
    delete process.env.BATCHER_EOA_ADDRESS;
    delete process.env.PROPOSER_EOA_ADDRESS;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // Manual Environment Variable Tests
  // ============================================================

  describe('detectOrUseManualEOA - Manual ENV', () => {
    it('should return manual EOAs if both env vars are set', async () => {
      process.env.BATCHER_EOA_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.PROPOSER_EOA_ADDRESS = '0x0987654321098765432109876543210987654321';

      const result = await detectOrUseManualEOA();

      expect(result.source).toBe('manual-env');
      expect(result.confidence).toBe('high');
      expect(result.batcherEOA).toBe('0x1234567890123456789012345678901234567890');
      expect(result.proposerEOA).toBe('0x0987654321098765432109876543210987654321');
    });

    it('should return not-detected if only one env var is set', async () => {
      process.env.BATCHER_EOA_ADDRESS = '0x1234567890123456789012345678901234567890';

      const result = await detectOrUseManualEOA();

      expect(result.source).toBe('not-detected');
      expect(result.confidence).toBe('low');
    });

    it('should return not-detected if env vars have invalid format', async () => {
      process.env.BATCHER_EOA_ADDRESS = 'invalid-address';
      process.env.PROPOSER_EOA_ADDRESS = '0x0987654321098765432109876543210987654321';

      const result = await detectOrUseManualEOA();

      expect(result.source).toBe('not-detected');
    });

    it('should normalize checksummed addresses', async () => {
      process.env.BATCHER_EOA_ADDRESS = '0x1234567890AbCdEf1234567890abcdef12345678';
      process.env.PROPOSER_EOA_ADDRESS = '0x0987654321098765432109876543210987654321';

      const result = await detectOrUseManualEOA();

      expect(result.source).toBe('manual-env');
      // viem's getAddress normalizes to checksum format
      expect(result.batcherEOA).toBeDefined();
    });
  });

  // ============================================================
  // Auto-Detection Tests (L1 Transaction Analysis)
  // ============================================================

  describe('detectOrUseManualEOA - Auto-Detection', () => {
    it('should return not-detected if no L1_RPC_URL', async () => {
      const result = await detectOrUseManualEOA('');

      expect(result.source).toBe('not-detected');
      expect(result.confidence).toBe('low');
      expect(result.message).toContain('No L1_RPC_URL');
    });

    it('should return not-detected if auto-detection fails', async () => {
      const result = await detectOrUseManualEOA('http://invalid-rpc-url:9999');

      expect(result.source).toBe('not-detected');
      expect(result.confidence).toBe('low');
    });
  });

  // ============================================================
  // getEOAAddressWithAutoDetect Tests
  // ============================================================

  describe('getEOAAddressWithAutoDetect', () => {
    it('should return manual env var if set', async () => {
      process.env.BATCHER_EOA_ADDRESS = '0x1234567890123456789012345678901234567890';

      const result = await getEOAAddressWithAutoDetect('batcher');

      expect(result).toBe('0x1234567890123456789012345678901234567890');
    });

    it('should return null if manual env not set and auto-detection unavailable', async () => {
      const result = await getEOAAddressWithAutoDetect('batcher', 'http://invalid-rpc:9999');

      expect(result).toBeNull();
    });

    it('should handle invalid env var gracefully', async () => {
      process.env.BATCHER_EOA_ADDRESS = 'not-an-address';

      const result = await getEOAAddressWithAutoDetect('batcher');

      expect(result).toBeNull();
    });

    it('should differentiate between batcher and proposer roles', async () => {
      process.env.BATCHER_EOA_ADDRESS = '0x1111111111111111111111111111111111111111';
      process.env.PROPOSER_EOA_ADDRESS = '0x2222222222222222222222222222222222222222';

      const batcherResult = await getEOAAddressWithAutoDetect('batcher');
      const proposerResult = await getEOAAddressWithAutoDetect('proposer');

      expect(batcherResult).toBe('0x1111111111111111111111111111111111111111');
      expect(proposerResult).toBe('0x2222222222222222222222222222222222222222');
    });
  });

  // ============================================================
  // Contract Address Mapping Tests
  // ============================================================

  describe('Optimism Contract Addresses', () => {
    it('should recognize Optimism Sepolia network', async () => {
      process.env.BATCHER_EOA_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.PROPOSER_EOA_ADDRESS = '0x0987654321098765432109876543210987654321';

      const result = await detectOrUseManualEOA(
        'http://localhost:8545',
        'optimism-sepolia'
      );

      expect(result.source).toBe('manual-env');
      expect(result.chainName).toBeDefined();
    });

    it('should recognize Base Mainnet network', async () => {
      process.env.BATCHER_EOA_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.PROPOSER_EOA_ADDRESS = '0x0987654321098765432109876543210987654321';

      const result = await detectOrUseManualEOA(
        'http://localhost:8545',
        'base-mainnet'
      );

      expect(result.source).toBe('manual-env');
      expect(result.chainName).toBeDefined();
    });
  });

  // ============================================================
  // Confidence Scoring Tests
  // ============================================================

  describe('Confidence Levels', () => {
    it('should assign high confidence when both EOAs detected', async () => {
      process.env.BATCHER_EOA_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.PROPOSER_EOA_ADDRESS = '0x0987654321098765432109876543210987654321';

      const result = await detectOrUseManualEOA();

      expect(result.confidence).toBe('high');
    });

    it('should assign low confidence when detection fails', async () => {
      const result = await detectOrUseManualEOA('http://invalid:9999');

      expect(result.confidence).toBe('low');
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================

  describe('Edge Cases', () => {
    it('should handle empty strings in env vars', async () => {
      process.env.BATCHER_EOA_ADDRESS = '';
      process.env.PROPOSER_EOA_ADDRESS = '';

      const result = await detectOrUseManualEOA();

      expect(result.source).toBe('not-detected');
    });

    it('should handle undefined env vars', async () => {
      delete process.env.BATCHER_EOA_ADDRESS;
      delete process.env.PROPOSER_EOA_ADDRESS;

      const result = await detectOrUseManualEOA('http://invalid:9999');

      expect(result.source).toBe('not-detected');
    });

    it('should be case-insensitive for address validation', async () => {
      process.env.BATCHER_EOA_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      process.env.PROPOSER_EOA_ADDRESS = '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD';

      const result = await detectOrUseManualEOA();

      expect(result.source).toBe('manual-env');
    });
  });
});
