/**
 * SIWE Nonce Store (Website Admin)
 * InMemory implementation for Vercel (stateless)
 * 1-use-per-nonce pattern: create() → consume() → deleted
 */

import { randomBytes } from 'crypto';

export const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface AdminNonceStore {
  create(address: `0x${string}`): Promise<string>;
  consume(address: `0x${string}`, nonce: string): Promise<boolean>;
}

class InMemoryAdminNonceStore implements AdminNonceStore {
  private nonces = new Map<string, { nonce: string; expiresAt: number }>();

  async create(address: `0x${string}`): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + NONCE_TTL_MS;
    this.nonces.set(this.key(address), { nonce, expiresAt });
    return nonce;
  }

  async consume(address: `0x${string}`, nonce: string): Promise<boolean> {
    const key = this.key(address);
    const entry = this.nonces.get(key);

    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.nonces.delete(key);
      return false;
    }
    if (entry.nonce !== nonce) return false;

    // Consumed: delete immediately
    this.nonces.delete(key);
    return true;
  }

  private key(address: `0x${string}`): string {
    return `admin:nonce:${address.toLowerCase()}`;
  }
}

// Singleton instance
let instance: AdminNonceStore | null = null;

export function getAdminNonceStore(): AdminNonceStore {
  if (!instance) {
    instance = new InMemoryAdminNonceStore();
  }
  return instance;
}
