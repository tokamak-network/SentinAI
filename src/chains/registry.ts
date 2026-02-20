/**
 * Chain Plugin Registry
 * Global singleton registry for the active chain plugin.
 * Loads chain plugin from CHAIN_TYPE, defaults to ThanosPlugin.
 */

import type { ChainPlugin } from './types';
import { ThanosPlugin } from './thanos';
import { OptimismPlugin } from './optimism';

let activePlugin: ChainPlugin | null = null;

function resolvePluginFromEnv(): ChainPlugin {
  const chainType = process.env.CHAIN_TYPE?.trim().toLowerCase();

  switch (chainType) {
    case undefined:
    case '':
    case 'thanos':
      return new ThanosPlugin();
    case 'optimism':
    case 'op-stack':
    case 'my-l2':
      return new OptimismPlugin();
    default:
      console.warn(`[ChainRegistry] Unknown CHAIN_TYPE "${chainType}", falling back to thanos`);
      return new ThanosPlugin();
  }
}

/**
 * Get the currently active chain plugin.
 * Auto-loads from CHAIN_TYPE if no plugin has been registered.
 */
export function getChainPlugin(): ChainPlugin {
  if (!activePlugin) {
    activePlugin = resolvePluginFromEnv();
    console.info(`[ChainRegistry] Auto-loaded default: ${activePlugin.displayName}`);
  }
  return activePlugin;
}

/**
 * Register a chain plugin as the active plugin.
 * Call this at startup to override the default (Thanos).
 */
export function registerChainPlugin(plugin: ChainPlugin): void {
  activePlugin = plugin;
  console.info(`[ChainRegistry] Registered: ${plugin.displayName} (${plugin.chainType})`);
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
