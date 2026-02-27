/**
 * Unit Tests for Core Security Module
 * Tests AES-256-GCM encrypt/decrypt, isEncrypted heuristic,
 * ConnectionConfig helpers, and URL masking.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  encrypt,
  decrypt,
  isEncrypted,
  encryptConnectionConfig,
  decryptConnectionConfig,
  maskConnectionConfig,
  maskUrl,
  _resetEncryptionKey,
} from '@/core/security';
import type { ConnectionConfig } from '@/core/types';

// ============================================================
// Mocks
// ============================================================

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ============================================================
// Helpers
// ============================================================

function setEncryptionKey(key: string): void {
  process.env.SENTINAI_ENCRYPTION_KEY = key;
  _resetEncryptionKey();
}

function clearEncryptionKeys(): void {
  delete process.env.SENTINAI_ENCRYPTION_KEY;
  delete process.env.SENTINAI_API_KEY;
  _resetEncryptionKey();
}

// ============================================================
// Tests
// ============================================================

describe('Security', () => {
  beforeEach(() => {
    // Use a stable 32-char key for all tests that need encryption
    setEncryptionKey('test-encryption-key-32chars-xxxx');
  });

  afterEach(() => {
    clearEncryptionKeys();
  });

  // ----------------------------------------------------------
  // encrypt / decrypt
  // ----------------------------------------------------------

  it('encrypt + decrypt round-trip returns the original plaintext', () => {
    const plaintext = 'super-secret-token-12345';
    const ciphertext = encrypt(plaintext);
    const decrypted = decrypt(ciphertext);

    expect(decrypted).toBe(plaintext);
  });

  it('encrypt produces a different ciphertext each call (random IV)', () => {
    const plaintext = 'same-input';
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);

    expect(c1).not.toBe(c2);
    // Both must still decrypt to the original
    expect(decrypt(c1)).toBe(plaintext);
    expect(decrypt(c2)).toBe(plaintext);
  });

  it('encrypted format is <iv>:<authTag>:<ciphertext> (three colon-separated parts)', () => {
    const ciphertext = encrypt('hello');
    const parts = ciphertext.split(':');
    expect(parts).toHaveLength(3);
    expect(parts.every(p => p.length > 0)).toBe(true);
  });

  // ----------------------------------------------------------
  // isEncrypted
  // ----------------------------------------------------------

  it('isEncrypted returns false for plain text', () => {
    expect(isEncrypted('plain-api-key')).toBe(false);
    expect(isEncrypted('hello world')).toBe(false);
    expect(isEncrypted('')).toBe(false);
  });

  it('isEncrypted returns true for an encrypted value', () => {
    const ciphertext = encrypt('secret');
    expect(isEncrypted(ciphertext)).toBe(true);
  });

  // ----------------------------------------------------------
  // encryptConnectionConfig
  // ----------------------------------------------------------

  it('encryptConnectionConfig encrypts the authToken field', () => {
    const config: ConnectionConfig = {
      rpcUrl: 'http://localhost:8545',
      authToken: 'my-plain-token',
    };
    const encrypted = encryptConnectionConfig(config);

    expect(encrypted.authToken).not.toBe('my-plain-token');
    expect(isEncrypted(encrypted.authToken!)).toBe(true);
    // Other fields untouched
    expect(encrypted.rpcUrl).toBe('http://localhost:8545');
  });

  it('encryptConnectionConfig does not double-encrypt an already-encrypted token', () => {
    const config: ConnectionConfig = {
      rpcUrl: 'http://localhost:8545',
      authToken: encrypt('already-encrypted'),
    };
    const result = encryptConnectionConfig(config);

    // authToken should be unchanged (same value)
    expect(result.authToken).toBe(config.authToken);
  });

  it('encryptConnectionConfig passes through when authToken is absent', () => {
    const config: ConnectionConfig = { rpcUrl: 'http://localhost:8545' };
    const result = encryptConnectionConfig(config);

    expect(result.authToken).toBeUndefined();
    expect(result.rpcUrl).toBe('http://localhost:8545');
  });

  // ----------------------------------------------------------
  // decryptConnectionConfig
  // ----------------------------------------------------------

  it('decryptConnectionConfig restores the original plaintext authToken', () => {
    const original = 'original-token';
    const encrypted: ConnectionConfig = {
      rpcUrl: 'http://localhost:8545',
      authToken: encrypt(original),
    };
    const decrypted = decryptConnectionConfig(encrypted);

    expect(decrypted.authToken).toBe(original);
  });

  it('decryptConnectionConfig passes through when authToken is plaintext', () => {
    const config: ConnectionConfig = {
      rpcUrl: 'http://localhost:8545',
      authToken: 'plain-token',
    };
    const result = decryptConnectionConfig(config);
    expect(result.authToken).toBe('plain-token');
  });

  // ----------------------------------------------------------
  // maskConnectionConfig
  // ----------------------------------------------------------

  it('maskConnectionConfig replaces authToken with "****"', () => {
    const config: ConnectionConfig = {
      rpcUrl: 'http://localhost:8545',
      authToken: 'my-secret',
    };
    const masked = maskConnectionConfig(config);

    expect(masked.authToken).toBe('****');
    expect(masked.rpcUrl).toBe('http://localhost:8545');
  });

  it('maskConnectionConfig sets authToken to undefined when absent', () => {
    const config: ConnectionConfig = { rpcUrl: 'http://localhost:8545' };
    const masked = maskConnectionConfig(config);

    expect(masked.authToken).toBeUndefined();
  });

  // ----------------------------------------------------------
  // maskUrl
  // ----------------------------------------------------------

  it('maskUrl masks basic-auth credentials in URL', () => {
    const url = 'https://user:secret@rpc.example.com';
    const masked = maskUrl(url);

    expect(masked).not.toContain('user:secret');
    expect(masked).toContain('@rpc.example.com');
    expect(masked).toContain('<credentials>');
  });

  it('maskUrl masks long API key path segments', () => {
    // Path segment longer than 20 chars should be replaced
    const url = 'https://rpc.example.com/v1/abcdefghij1234567890xyz';
    const masked = maskUrl(url);

    expect(masked).toContain('<token>');
    expect(masked).not.toContain('abcdefghij1234567890xyz');
  });

  it('maskUrl leaves short path segments unchanged', () => {
    const url = 'https://rpc.example.com/v1/eth';
    const masked = maskUrl(url);

    expect(masked).toContain('/v1/eth');
  });

  // ----------------------------------------------------------
  // Plaintext fallback (no key configured)
  // ----------------------------------------------------------

  it('encrypt returns plaintext unchanged when no encryption key is set', () => {
    clearEncryptionKeys();
    const plaintext = 'no-key-value';
    const result = encrypt(plaintext);

    expect(result).toBe(plaintext);
  });

  it('decrypt returns ciphertext unchanged when no encryption key is set', () => {
    clearEncryptionKeys();
    const value = 'not-actually-encrypted';
    const result = decrypt(value);

    expect(result).toBe(value);
  });
});
