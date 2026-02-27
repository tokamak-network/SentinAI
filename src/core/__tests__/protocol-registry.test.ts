/**
 * Unit Tests for Protocol Registry
 * Tests registration, retrieval, deduplication, and query operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerProtocol,
  replaceProtocol,
  getProtocol,
  findProtocol,
  listProtocols,
  hasProtocol,
  clearProtocols,
  getProtocolCount,
} from '@/core/protocol-registry';
import type { ProtocolDescriptor } from '@/core/types';

// ============================================================
// Test Helpers
// ============================================================

function makeDescriptor(
  protocolId: ProtocolDescriptor['protocolId'],
  overrides?: Partial<ProtocolDescriptor>
): ProtocolDescriptor {
  return {
    protocolId,
    displayName: `Test ${protocolId}`,
    metricsFields: [],
    collectorType: 'evm-execution',
    capabilities: ['block-production'],
    anomalyConfig: {},
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('ProtocolRegistry', () => {
  beforeEach(() => {
    clearProtocols();
  });

  it('registerProtocol - getProtocol returns the registered descriptor', () => {
    const descriptor = makeDescriptor('opstack-l2');
    registerProtocol(descriptor);

    const result = getProtocol('opstack-l2');
    expect(result.protocolId).toBe('opstack-l2');
    expect(result.displayName).toBe('Test opstack-l2');
  });

  it('registerProtocol - throws on duplicate protocolId', () => {
    registerProtocol(makeDescriptor('ethereum-el'));
    expect(() => registerProtocol(makeDescriptor('ethereum-el'))).toThrowError(
      /already registered/
    );
  });

  it('replaceProtocol - silently replaces an existing descriptor', () => {
    registerProtocol(makeDescriptor('opstack-l2', { displayName: 'Original' }));
    expect(() =>
      replaceProtocol(makeDescriptor('opstack-l2', { displayName: 'Replaced' }))
    ).not.toThrow();

    const result = getProtocol('opstack-l2');
    expect(result.displayName).toBe('Replaced');
  });

  it('replaceProtocol - registers a new descriptor if not yet present', () => {
    expect(() =>
      replaceProtocol(makeDescriptor('arbitrum-nitro'))
    ).not.toThrow();
    expect(getProtocol('arbitrum-nitro').protocolId).toBe('arbitrum-nitro');
  });

  it('getProtocol - throws when protocolId is not registered', () => {
    expect(() => getProtocol('zkstack')).toThrowError(/not registered/);
  });

  it('findProtocol - returns undefined when protocolId is not registered', () => {
    const result = findProtocol('ethereum-cl');
    expect(result).toBeUndefined();
  });

  it('findProtocol - returns the descriptor when registered', () => {
    registerProtocol(makeDescriptor('ethereum-cl'));
    const result = findProtocol('ethereum-cl');
    expect(result?.protocolId).toBe('ethereum-cl');
  });

  it('listProtocols - returns all 5 registered descriptors', () => {
    const allIds: ProtocolDescriptor['protocolId'][] = [
      'ethereum-el',
      'ethereum-cl',
      'opstack-l2',
      'arbitrum-nitro',
      'zkstack',
    ];
    for (const id of allIds) {
      registerProtocol(makeDescriptor(id));
    }

    const list = listProtocols();
    expect(list).toHaveLength(5);
    const registeredIds = list.map(d => d.protocolId);
    for (const id of allIds) {
      expect(registeredIds).toContain(id);
    }
  });

  it('hasProtocol - returns true for registered protocol', () => {
    registerProtocol(makeDescriptor('zkstack'));
    expect(hasProtocol('zkstack')).toBe(true);
  });

  it('hasProtocol - returns false for unregistered protocol', () => {
    expect(hasProtocol('ethereum-el')).toBe(false);
  });

  it('getProtocolCount - matches the number of registrations', () => {
    expect(getProtocolCount()).toBe(0);
    registerProtocol(makeDescriptor('ethereum-el'));
    expect(getProtocolCount()).toBe(1);
    registerProtocol(makeDescriptor('opstack-l2'));
    expect(getProtocolCount()).toBe(2);
  });

  it('clearProtocols - empties the registry', () => {
    registerProtocol(makeDescriptor('ethereum-el'));
    registerProtocol(makeDescriptor('opstack-l2'));
    clearProtocols();
    expect(getProtocolCount()).toBe(0);
    expect(listProtocols()).toHaveLength(0);
  });
});
