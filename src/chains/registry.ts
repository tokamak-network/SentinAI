/**
 * Chain Plugin Registry
 * Global singleton registry for the active chain plugin.
 * Loads chain plugin from CHAIN_TYPE, defaults to ThanosPlugin.
 */

import type { ChainPlugin } from './types';
import { ThanosPlugin } from './thanos';
import { OptimismPlugin } from './optimism';
import { ZkstackPlugin } from './zkstack';
import { ArbitrumPlugin } from './arbitrum';
import { ZkL2GenericPlugin } from './zkl2-generic';
import { L1EVMPlugin } from './l1-evm';
import logger from '@/lib/logger';
import { parseTopologyFromEnv } from '@/lib/client-profile';

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
    case 'zkstack':
    case 'zksync':
    case 'zk-stack':
      return new ZkstackPlugin();
    case 'arbitrum':
    case 'arbitrum-orbit':
    case 'nitro':
      return new ArbitrumPlugin();
    case 'zkl2-generic':
    case 'zkl2':
    case 'scroll':
    case 'linea':
    case 'polygon-zkevm':
    case 'zkevm':
      return new ZkL2GenericPlugin();
    case 'l1-evm':
    case 'l1':
      return new L1EVMPlugin();
    default:
      logger.warn(`[ChainRegistry] Unknown CHAIN_TYPE "${chainType}", falling back to thanos`);
      return new ThanosPlugin();
  }
}

/**
 * Apply SENTINAI_COMPONENTS / SENTINAI_COMPONENT_DEPS topology overrides to a plugin.
 * Returns the original plugin unchanged when no relevant env vars are set or on parse error.
 * Never throws.
 */
function applyTopologyEnvOverrides(plugin: ChainPlugin): ChainPlugin {
  const topology = parseTopologyFromEnv();

  if (!topology) return plugin;
  if (topology.components.length === 0) return plugin;

  const existingByName = new Map(plugin.components.map((c) => [c, c]));
  const overriddenComponents = topology.components.map((name) => existingByName.get(name) ?? name);

  return {
    ...plugin,
    components: overriddenComponents,
    dependencyGraph: Object.keys(topology.dependencyGraph).length > 0
      ? topology.dependencyGraph
      : plugin.dependencyGraph,
  };
}

/**
 * Get the currently active chain plugin.
 * Auto-loads from CHAIN_TYPE if no plugin has been registered.
 * Applies SENTINAI_COMPONENTS / SENTINAI_COMPONENT_DEPS topology overrides on each call.
 */
export function getChainPlugin(): ChainPlugin {
  if (!activePlugin) {
    activePlugin = resolvePluginFromEnv();
    logger.info(`[ChainRegistry] Auto-loaded default: ${activePlugin.displayName}`);
  }
  return applyTopologyEnvOverrides(activePlugin);
}

/**
 * Register a chain plugin as the active plugin.
 * Call this at startup to override the default (Thanos).
 */
export function registerChainPlugin(plugin: ChainPlugin): void {
  activePlugin = plugin;
  logger.info(`[ChainRegistry] Registered: ${plugin.displayName} (${plugin.chainType})`);
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
