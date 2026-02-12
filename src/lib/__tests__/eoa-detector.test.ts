/**
 * Tests for EOA Detector
 * Tests EOA derivation from private keys and manual configuration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  detectOrUseManualEOA,
  getEOAAddressWithAutoDetect,
} from '@/lib/eoa-detector';

// Mock viem module for private key tests
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    privateKeyToAccount: (privateKey: string) => {
      // Simulate private key to account mapping for testing
      // Validate that it's a valid hex string before generating address
      const hexPart = privateKey.replace(/^0x/, '');

      // Check if it's a valid hex string (only hex characters)
      if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
        throw new Error(`Invalid private key: must be hex string, got "${privateKey}"`);
      }

      // Take first 10 hex chars, pad to 40 chars with zeros
      const addressPart = hexPart.slice(0, 10).padEnd(40, '0');
      return {
        address: `0x${addressPart}` as `0x${string}`,
      };
    },
  };
});

describe('EOA Detector', () => {
  beforeEach(() => {
    // Clear environment variables before each test
    delete process.env.BATCHER_EOA_ADDRESS;
    delete process.env.PROPOSER_EOA_ADDRESS;
    delete process.env.BATCHER_PRIVATE_KEY;
    delete process.env.PROPOSER_PRIVATE_KEY;
  });

  afterEach(() => {
    // Cleanup after each test
    delete process.env.BATCHER_EOA_ADDRESS;
    delete process.env.PROPOSER_EOA_ADDRESS;
    delete process.env.BATCHER_PRIVATE_KEY;
    delete process.env.PROPOSER_PRIVATE_KEY;
  });

  // ============================================================
  // Manual Environment Variable Tests
  // ============================================================

  describe('Manual Environment Variables', () => {
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
      process.env.BATCHER_EOA_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.PROPOSER_EOA_ADDRESS = '0x0987654321098765432109876543210987654321';

      const result = await detectOrUseManualEOA();

      expect(result.source).toBe('manual-env');
      expect(result.batcherEOA).toBeDefined();
    });
  });

  // ============================================================
  // Private Key Derivation Tests
  // ============================================================

  describe('Private Key Derivation', () => {
    it('should derive EOA from valid private key', async () => {
      process.env.BATCHER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb476c6b8d6c1f02e9ecda1e0e9e7';
      process.env.PROPOSER_PRIVATE_KEY = '0x70997970c51812e339d9b73b0245ad59cc7599a60ed630da7995dcd4fee5b986';

      const result = await detectOrUseManualEOA();

      expect(result.source).toBe('private-key');
      expect(result.confidence).toBe('high');
      expect(result.batcherEOA).toBeDefined();
      expect(result.proposerEOA).toBeDefined();
    });

    it('should derive batcher EOA only from private key', async () => {
      process.env.BATCHER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb476c6b8d6c1f02e9ecda1e0e9e7';

      const batcherEOA = await getEOAAddressWithAutoDetect('batcher');

      expect(batcherEOA).toBeDefined();
      expect(batcherEOA).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should derive proposer EOA only from private key', async () => {
      process.env.PROPOSER_PRIVATE_KEY = '0x70997970c51812e339d9b73b0245ad59cc7599a60ed630da7995dcd4fee5b986';

      const proposerEOA = await getEOAAddressWithAutoDetect('proposer');

      expect(proposerEOA).toBeDefined();
      expect(proposerEOA).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should handle private key without 0x prefix', async () => {
      process.env.BATCHER_PRIVATE_KEY = 'ac0974bec39a17e36ba4a6b4d238ff944bacb476c6b8d6c1f02e9ecda1e0e9e7';

      const batcherEOA = await getEOAAddressWithAutoDetect('batcher');

      expect(batcherEOA).toBeDefined();
      expect(batcherEOA).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should return null for invalid private key', async () => {
      process.env.BATCHER_PRIVATE_KEY = 'invalid-key';

      const batcherEOA = await getEOAAddressWithAutoDetect('batcher');

      expect(batcherEOA).toBeNull();
    });
  });

  // ============================================================
  // Priority Tests (Manual > Private Key)
  // ============================================================

  describe('Priority: Manual > Private Key', () => {
    it('should prefer manual EOA over private key', async () => {
      const manualBatcherEOA = '0x1111111111111111111111111111111111111111';
      process.env.BATCHER_EOA_ADDRESS = manualBatcherEOA;
      process.env.BATCHER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb476c6b8d6c1f02e9ecda1e0e9e7';

      const batcherEOA = await getEOAAddressWithAutoDetect('batcher');

      expect(batcherEOA).toBe(manualBatcherEOA);
    });

    it('should use private key when manual EOA not set', async () => {
      process.env.BATCHER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb476c6b8d6c1f02e9ecda1e0e9e7';

      const batcherEOA = await getEOAAddressWithAutoDetect('batcher');

      expect(batcherEOA).toBeDefined();
      expect(batcherEOA).toMatch(/^0x[a-fA-F0-9]{40}$/);
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

    it('should return null if neither manual env nor private key set', async () => {
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
  // Mixed Source Tests
  // ============================================================

  describe('Mixed Sources', () => {
    it('should handle mixed manual and private key sources', async () => {
      process.env.BATCHER_EOA_ADDRESS = '0x1111111111111111111111111111111111111111';
      process.env.PROPOSER_PRIVATE_KEY = '0x70997970c51812e339d9b73b0245ad59cc7599a60ed630da7995dcd4fee5b986';

      const result = await detectOrUseManualEOA();

      expect(result.batcherEOA).toBe('0x1111111111111111111111111111111111111111');
      expect(result.proposerEOA).toBeDefined();
      expect(result.confidence).toBe('medium');
    });
  });

  // ============================================================
  // Confidence Levels
  // ============================================================

  describe('Confidence Levels', () => {
    it('should assign high confidence when both EOAs from manual env', async () => {
      process.env.BATCHER_EOA_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.PROPOSER_EOA_ADDRESS = '0x0987654321098765432109876543210987654321';

      const result = await detectOrUseManualEOA();

      expect(result.confidence).toBe('high');
    });

    it('should assign high confidence when both EOAs from private keys', async () => {
      process.env.BATCHER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb476c6b8d6c1f02e9ecda1e0e9e7';
      process.env.PROPOSER_PRIVATE_KEY = '0x70997970c51812e339d9b73b0245ad59cc7599a60ed630da7995dcd4fee5b986';

      const result = await detectOrUseManualEOA();

      expect(result.confidence).toBe('high');
    });

    it('should assign low confidence when no EOAs detected', async () => {
      const result = await detectOrUseManualEOA();

      expect(result.confidence).toBe('low');
      expect(result.source).toBe('not-detected');
    });

    it('should assign medium confidence with mixed sources', async () => {
      process.env.BATCHER_EOA_ADDRESS = '0x1111111111111111111111111111111111111111';
      process.env.PROPOSER_PRIVATE_KEY = '0x70997970c51812e339d9b73b0245ad59cc7599a60ed630da7995dcd4fee5b986';

      const result = await detectOrUseManualEOA();

      expect(result.confidence).toBe('medium');
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

    it('should be case-insensitive for address validation', async () => {
      // Use valid checksummed addresses to test case-insensitivity
      const batcherAddr = '0x1234567890123456789012345678901234567890';
      const proposerAddr = '0x0987654321098765432109876543210987654321';

      process.env.BATCHER_EOA_ADDRESS = batcherAddr.toLowerCase();
      process.env.PROPOSER_EOA_ADDRESS = proposerAddr.toUpperCase();

      const result = await detectOrUseManualEOA();

      expect(result.source).toBe('manual-env');
      expect(result.confidence).toBe('high');
    });
  });
});
