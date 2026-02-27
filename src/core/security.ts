/**
 * Core Security Module
 * AES-256-GCM encryption for sensitive ConnectionConfig fields (authToken).
 * URL masking utilities for safe logging.
 *
 * Encryption key is derived from SENTINAI_ENCRYPTION_KEY env var.
 * Falls back to a deterministic key based on SENTINAI_API_KEY if not set.
 * If neither is available, authTokens are stored in plaintext (dev mode).
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import type { ConnectionConfig } from './types';
import logger from '@/lib/logger';

// ============================================================
// Constants
// ============================================================

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;   // 256 bits
const IV_LENGTH = 12;    // 96 bits (recommended for GCM)
const TAG_LENGTH = 16;   // 128-bit authentication tag

// ============================================================
// Key Derivation
// ============================================================

let _encryptionKey: Buffer | null = null;

/**
 * Get or derive the AES-256 encryption key.
 * Priority:
 *   1. SENTINAI_ENCRYPTION_KEY (32+ char hex or raw string)
 *   2. SENTINAI_API_KEY (hashed to 32 bytes via SHA-256)
 *   3. null → plaintext mode (dev only, logs a warning once)
 */
function getEncryptionKey(): Buffer | null {
  if (_encryptionKey) return _encryptionKey;

  const encKey = process.env.SENTINAI_ENCRYPTION_KEY;
  if (encKey) {
    // Accept hex (64 chars) or raw string (padded/truncated to 32 bytes)
    _encryptionKey = Buffer.from(
      encKey.length === 64 ? encKey : createHash('sha256').update(encKey).digest('hex'),
      'hex'
    ).slice(0, KEY_LENGTH);
    return _encryptionKey;
  }

  const apiKey = process.env.SENTINAI_API_KEY;
  if (apiKey) {
    _encryptionKey = createHash('sha256').update(apiKey).digest().slice(0, KEY_LENGTH);
    return _encryptionKey;
  }

  logger.warn(
    '[Security] No SENTINAI_ENCRYPTION_KEY or SENTINAI_API_KEY set. ' +
    'authTokens stored in plaintext. Set SENTINAI_ENCRYPTION_KEY for production.'
  );
  return null;
}

// ============================================================
// Encryption / Decryption
// ============================================================

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string: `<iv>:<authTag>:<ciphertext>`.
 * Returns the original string if no encryption key is configured (dev mode).
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) return plaintext; // plaintext fallback

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a ciphertext string previously encrypted with encrypt().
 * Returns the original string if no encryption key is configured (dev mode).
 * Throws if the ciphertext is malformed or the auth tag is invalid.
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  if (!key) return ciphertext; // plaintext fallback

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('[Security] Invalid encrypted format: expected <iv>:<authTag>:<ciphertext>');
  }

  const [ivB64, authTagB64, encryptedB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`[Security] Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
  }
  if (authTag.length !== TAG_LENGTH) {
    throw new Error(`[Security] Invalid auth tag length`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Check if a string looks like an encrypted ciphertext (not plaintext).
 * Heuristic: contains two `:` separators and base64-encoded segments.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && parts.every(p => /^[A-Za-z0-9+/=]+$/.test(p));
}

// ============================================================
// ConnectionConfig Helpers
// ============================================================

/**
 * Return a copy of ConnectionConfig with authToken encrypted.
 * Safe to call even if authToken is already encrypted or missing.
 */
export function encryptConnectionConfig(config: ConnectionConfig): ConnectionConfig {
  if (!config.authToken) return { ...config };
  if (isEncrypted(config.authToken)) return { ...config }; // already encrypted

  return {
    ...config,
    authToken: encrypt(config.authToken),
  };
}

/**
 * Return a copy of ConnectionConfig with authToken decrypted.
 * Safe to call even if authToken is plaintext or missing.
 */
export function decryptConnectionConfig(config: ConnectionConfig): ConnectionConfig {
  if (!config.authToken) return { ...config };
  if (!isEncrypted(config.authToken)) return { ...config }; // already plaintext

  return {
    ...config,
    authToken: decrypt(config.authToken),
  };
}

/**
 * Return a copy of ConnectionConfig with authToken masked for API responses and logs.
 * Never expose the real token to clients.
 */
export function maskConnectionConfig(config: ConnectionConfig): ConnectionConfig {
  return {
    ...config,
    authToken: config.authToken ? '****' : undefined,
  };
}

// ============================================================
// URL Masking
// ============================================================

/**
 * Mask credentials in a URL string for safe logging.
 * "https://user:secret@rpc.example.com/v1/key123" → "https://****@rpc.example.com/v1/****"
 */
export function maskUrl(url: string): string {
  return url
    .replace(/\/\/[^@]+@/, '//<credentials>@')  // Basic auth in URL
    .replace(/(\/[a-zA-Z0-9]{20,})/g, '/<token>'); // Long path segments (API keys)
}

/**
 * Reset the cached encryption key (for testing).
 */
export function _resetEncryptionKey(): void {
  _encryptionKey = null;
}
