/**
 * Protocol Registry
 * In-memory singleton that holds all registered ProtocolDescriptors.
 * Loaded at startup from src/protocols/<type>/descriptor.ts
 *
 * Thread-safe read operations; write (register) is startup-only.
 */

import type { ProtocolDescriptor } from './types';
import type { NodeType } from './types';

// ============================================================
// Registry State
// ============================================================

/** Singleton store — survives Next.js Turbopack hot reload */
const g = globalThis as unknown as {
  __sentinai_protocol_registry?: Map<NodeType, ProtocolDescriptor>;
};

function getRegistry(): Map<NodeType, ProtocolDescriptor> {
  if (!g.__sentinai_protocol_registry) {
    g.__sentinai_protocol_registry = new Map();
  }
  return g.__sentinai_protocol_registry;
}

// ============================================================
// Public API
// ============================================================

/**
 * Register a ProtocolDescriptor.
 * Throws if a descriptor with the same protocolId is already registered.
 * Call this at application startup from each protocol's descriptor.ts.
 */
export function registerProtocol(descriptor: ProtocolDescriptor): void {
  const registry = getRegistry();
  if (registry.has(descriptor.protocolId)) {
    throw new Error(
      `[ProtocolRegistry] Protocol "${descriptor.protocolId}" is already registered. ` +
      'Use replaceProtocol() if an intentional override is needed.'
    );
  }
  registry.set(descriptor.protocolId, descriptor);
}

/**
 * Override an existing descriptor (useful in tests).
 * Silently replaces if exists; registers if not.
 */
export function replaceProtocol(descriptor: ProtocolDescriptor): void {
  getRegistry().set(descriptor.protocolId, descriptor);
}

/**
 * Get a ProtocolDescriptor by protocolId.
 * Throws if not found — callers should catch and return 400/404.
 */
export function getProtocol(protocolId: NodeType): ProtocolDescriptor {
  const descriptor = getRegistry().get(protocolId);
  if (!descriptor) {
    throw new Error(
      `[ProtocolRegistry] Protocol "${protocolId}" is not registered. ` +
      `Registered protocols: [${listProtocols().map(d => d.protocolId).join(', ')}]`
    );
  }
  return descriptor;
}

/**
 * Get a ProtocolDescriptor by protocolId, returns undefined if not found.
 */
export function findProtocol(protocolId: string): ProtocolDescriptor | undefined {
  return getRegistry().get(protocolId as NodeType);
}

/**
 * List all registered ProtocolDescriptors.
 */
export function listProtocols(): ProtocolDescriptor[] {
  return Array.from(getRegistry().values());
}

/**
 * Check if a protocol is registered.
 */
export function hasProtocol(protocolId: string): boolean {
  return getRegistry().has(protocolId as NodeType);
}

/**
 * Clear all registered protocols (for testing only).
 */
export function clearProtocols(): void {
  getRegistry().clear();
}

/**
 * Return the number of registered protocols.
 */
export function getProtocolCount(): number {
  return getRegistry().size;
}
