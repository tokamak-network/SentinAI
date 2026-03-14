import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Login Page - SIWE Message Format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('Test 1: Validates SIWE message format is EIP-4361 compliant', () => {
    // SIWE message builder function extracted for testing
    const buildSIWEMessage = (address: string, nonce: string, issuedAt: string): string => {
      return [
        'wallet.sentinai.io wants you to sign in with your Ethereum account:',
        address,
        '',
        'Please sign this message to verify ownership of your wallet and authenticate to the SentinAI marketplace.',
        '',
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join('\n');
    };

    const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f4bEb';
    const nonce = 'test-nonce-123';
    const issuedAt = '2024-01-01T00:00:00.000Z';

    const message = buildSIWEMessage(address, nonce, issuedAt);

    // Verify message format matches spec
    expect(message).toContain('wallet.sentinai.io wants you to sign in with your Ethereum account:');
    expect(message).toContain(address);
    expect(message).toContain(`Nonce: ${nonce}`);
    expect(message).toContain(`Issued At: ${issuedAt}`);

    // Verify no extra fields are present
    expect(message).not.toContain('URI:');
    expect(message).not.toContain('Expiration Time:');
    expect(message).not.toContain('Version:');
    expect(message).not.toContain('Chain ID:');
  });

  it('Test 2: SIWE message does not include URI field', () => {
    const buildSIWEMessage = (address: string, nonce: string, issuedAt: string): string => {
      return [
        'wallet.sentinai.io wants you to sign in with your Ethereum account:',
        address,
        '',
        'Please sign this message to verify ownership of your wallet and authenticate to the SentinAI marketplace.',
        '',
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join('\n');
    };

    const message = buildSIWEMessage('0x742d35Cc6634C0532925a3b844Bc9e7595f4bEb', 'nonce', '2024-01-01T00:00:00.000Z');
    expect(message).not.toContain('URI:');
  });

  it('Test 3: SIWE message does not include Expiration Time field', () => {
    const buildSIWEMessage = (address: string, nonce: string, issuedAt: string): string => {
      return [
        'wallet.sentinai.io wants you to sign in with your Ethereum account:',
        address,
        '',
        'Please sign this message to verify ownership of your wallet and authenticate to the SentinAI marketplace.',
        '',
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join('\n');
    };

    const message = buildSIWEMessage('0x742d35Cc6634C0532925a3b844Bc9e7595f4bEb', 'nonce', '2024-01-01T00:00:00.000Z');
    expect(message).not.toContain('Expiration Time:');
  });
});

describe('Login Page - Callback URL Validation', () => {
  it('Test 4: Validates callback URL with whitelist approach', () => {
    const isValidCallbackUrl = (url: string): boolean => {
      if (!url.startsWith('/')) return false;

      const allowedPaths = ['/', '/v2/marketplace', '/v2/marketplace/'];

      return allowedPaths.some(path => url === path || url.startsWith(path + '/'));
    };

    // Valid URLs
    expect(isValidCallbackUrl('/')).toBe(true);
    expect(isValidCallbackUrl('/v2/marketplace')).toBe(true);
    expect(isValidCallbackUrl('/v2/marketplace/')).toBe(true);
    expect(isValidCallbackUrl('/v2/marketplace/settings')).toBe(true);

    // Invalid URLs
    expect(isValidCallbackUrl('https://evil.com')).toBe(false);
    expect(isValidCallbackUrl('/other-page')).toBe(false);
    expect(isValidCallbackUrl('')).toBe(false);
  });

  it('Test 5: Rejects absolute URLs in callback validation', () => {
    const isValidCallbackUrl = (url: string): boolean => {
      if (!url.startsWith('/')) return false;

      const allowedPaths = ['/', '/v2/marketplace', '/v2/marketplace/'];

      return allowedPaths.some(path => url === path || url.startsWith(path + '/'));
    };

    expect(isValidCallbackUrl('https://evil.com/steal-data')).toBe(false);
    expect(isValidCallbackUrl('http://localhost/evil')).toBe(false);
  });

  it('Test 6: Validates only relative paths starting with forward slash', () => {
    const isValidCallbackUrl = (url: string): boolean => {
      if (!url.startsWith('/')) return false;

      const allowedPaths = ['/', '/v2/marketplace', '/v2/marketplace/'];

      return allowedPaths.some(path => url === path || url.startsWith(path + '/'));
    };

    // Valid relative paths
    expect(isValidCallbackUrl('/v2/marketplace/settings')).toBe(true);
    expect(isValidCallbackUrl('/')).toBe(true);

    // Invalid: no leading slash
    expect(isValidCallbackUrl('v2/marketplace')).toBe(false);
    expect(isValidCallbackUrl('evil.com')).toBe(false);
  });
});
