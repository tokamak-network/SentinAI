/**
 * Chain Plugin Registry
 * Global singleton registry for the active chain plugin.
 * Loads ThanosPlugin as default when CHAIN_TYPE is unset.
 */

import type { ChainPlugin } from './types';
import { ThanosPlugin } from './thanos';

let activePlugin: ChainPlugin | null = null;

/**
 * Get the currently active chain plugin.
 * Auto-loads ThanosPlugin if no plugin has been registered.
 */
export function getChainPlugin(): ChainPlugin {
  if (!activePlugin) {
    activePlugin = new ThanosPlugin();
    console.log(`[ChainRegistry] Auto-loaded default: ${activePlugin.displayName}`);
  }
  return activePlugin;
}

/**
 * Register a chain plugin as the active plugin.
 * Call this at startup to override the default (Thanos).
 */
export function registerChainPlugin(plugin: ChainPlugin): void {
  activePlugin = plugin;
  console.log(`[ChainRegistry] Registered: ${plugin.displayName} (${plugin.chainType})`);
}

/**
 * Get the current chain type identifier.
 */
export function getChainType(): string {
  return getChainPlugin().chainType;
}

/**
 * Reset the registry (for testing only).
 */
export function resetChainRegistry(): void {
  activePlugin = null;
}
