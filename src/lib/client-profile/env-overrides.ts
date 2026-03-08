import type { ClientProfile, CustomMetricConfig, SyncStatusParser } from './types';
import { BUILTIN_PROFILES } from './builtin-profiles';
import { mergeWithBuiltins } from './custom-profiles';

/** Returns SENTINAI_CLIENT_FAMILY env var value, or null if not set */
export function getClientFamilyFromEnv(): string | null {
  return process.env.SENTINAI_CLIENT_FAMILY ?? null;
}

/**
 * Build a ClientProfile by applying env var overrides on top of a base profile.
 * If no base profile is provided, starts from an empty 'custom' profile.
 * Never throws — logs warnings on parse errors and continues with defaults.
 */
export function buildClientProfileFromEnv(baseProfile?: ClientProfile): ClientProfile {
  const base: ClientProfile = baseProfile ?? {
    clientFamily: process.env.SENTINAI_CLIENT_FAMILY ?? 'custom',
    methods: {
      blockNumber: { method: 'eth_blockNumber' },
      syncStatus: { method: 'eth_syncing' },
      txPool: null,
      peerCount: null,
      l2SyncStatus: null,
      gasPrice: { method: 'eth_gasPrice' },
      chainId: { method: 'eth_chainId' },
    },
    parsers: {
      syncStatus: { type: 'standard' },
      txPool: null,
    },
    capabilities: {
      supportsTxPool: false,
      supportsPeerCount: false,
      supportsL2SyncStatus: false,
      supportsDebugNamespace: false,
    },
    customMetrics: [],
  };

  // Deep clone to avoid mutating the built-in profile
  const profile: ClientProfile = JSON.parse(JSON.stringify(base)) as ClientProfile;

  // --- RPC Method Overrides ---

  const blockNumberMethod = process.env.SENTINAI_OVERRIDE_BLOCK_NUMBER_METHOD;
  if (blockNumberMethod) profile.methods.blockNumber = { method: blockNumberMethod };

  const syncStatusMethod = process.env.SENTINAI_OVERRIDE_SYNC_STATUS_METHOD;
  if (syncStatusMethod) profile.methods.syncStatus = { method: syncStatusMethod };

  const syncParser = process.env.SENTINAI_OVERRIDE_SYNC_STATUS_PARSER;
  if (syncParser) {
    const validParsers = ['standard', 'nethermind', 'op-geth', 'nitro', 'custom'] as const;
    if ((validParsers as readonly string[]).includes(syncParser)) {
      const parsed: SyncStatusParser = { type: syncParser as SyncStatusParser['type'] };
      if (syncParser === 'custom') {
        const cur = process.env.SENTINAI_OVERRIDE_SYNC_CURRENT_BLOCK_PATH;
        const high = process.env.SENTINAI_OVERRIDE_SYNC_HIGHEST_BLOCK_PATH;
        const isSyncing = process.env.SENTINAI_OVERRIDE_SYNC_IS_SYNCING_PATH;
        if (cur) parsed.currentBlockPath = cur;
        if (high) parsed.highestBlockPath = high;
        if (isSyncing) parsed.isSyncingPath = isSyncing;
      }
      profile.parsers.syncStatus = parsed;
    } else {
      console.warn(`[SentinAI] Unknown SENTINAI_OVERRIDE_SYNC_STATUS_PARSER: ${syncParser}`);
    }
  }

  const l2SyncMethod = process.env.SENTINAI_OVERRIDE_L2_SYNC_METHOD;
  if (l2SyncMethod) {
    profile.methods.l2SyncStatus = { method: l2SyncMethod };
  }

  const txpoolMethod = process.env.SENTINAI_OVERRIDE_TXPOOL_METHOD;
  if (txpoolMethod) {
    const countPath = process.env.SENTINAI_OVERRIDE_TXPOOL_COUNT_PATH;
    profile.methods.txPool = countPath
      ? { method: txpoolMethod, responsePath: countPath }
      : { method: txpoolMethod };
  }

  const txpoolParser = process.env.SENTINAI_OVERRIDE_TXPOOL_PARSER;
  if (txpoolParser) {
    const validTxPool = ['txpool', 'parity', 'custom', null] as const;
    if ((validTxPool as readonly (string | null)[]).includes(txpoolParser)) {
      profile.parsers.txPool = txpoolParser as 'txpool' | 'parity' | 'custom';
    }
  }

  const peerCountMethod = process.env.SENTINAI_OVERRIDE_PEER_COUNT_METHOD;
  if (peerCountMethod) {
    const peerPath = process.env.SENTINAI_OVERRIDE_PEER_COUNT_PATH;
    profile.methods.peerCount = peerPath
      ? { method: peerCountMethod, responsePath: peerPath }
      : { method: peerCountMethod };
  }

  const gasPriceMethod = process.env.SENTINAI_OVERRIDE_GAS_PRICE_METHOD;
  if (gasPriceMethod) profile.methods.gasPrice = { method: gasPriceMethod };

  // --- Capability Overrides ---

  const capTxPool = process.env.SENTINAI_CAPABILITY_TXPOOL;
  if (capTxPool !== undefined) profile.capabilities.supportsTxPool = capTxPool === 'true';

  const capPeerCount = process.env.SENTINAI_CAPABILITY_PEER_COUNT;
  if (capPeerCount !== undefined) profile.capabilities.supportsPeerCount = capPeerCount === 'true';

  const capL2Sync = process.env.SENTINAI_CAPABILITY_L2_SYNC;
  if (capL2Sync !== undefined) profile.capabilities.supportsL2SyncStatus = capL2Sync === 'true';

  const capDebug = process.env.SENTINAI_CAPABILITY_DEBUG_NAMESPACE;
  if (capDebug !== undefined) profile.capabilities.supportsDebugNamespace = capDebug === 'true';

  // --- Custom Metrics ---
  const customMetrics = parseCustomMetricsFromEnv();
  if (customMetrics.length > 0) {
    profile.customMetrics = [...profile.customMetrics, ...customMetrics];
  }

  return profile;
}

/** Parse SENTINAI_CUSTOM_METRIC_N_* env vars into CustomMetricConfig array (N = 1..10) */
export function parseCustomMetricsFromEnv(): CustomMetricConfig[] {
  const metrics: CustomMetricConfig[] = [];

  for (let n = 1; n <= 10; n++) {
    const name = process.env[`SENTINAI_CUSTOM_METRIC_${n}_NAME`];
    const method = process.env[`SENTINAI_CUSTOM_METRIC_${n}_METHOD`];

    // Both name and method are required
    if (!name || !method) continue;

    const displayName = process.env[`SENTINAI_CUSTOM_METRIC_${n}_DISPLAY`] ?? name;
    const responsePath = process.env[`SENTINAI_CUSTOM_METRIC_${n}_PATH`] ?? '';
    const unit = process.env[`SENTINAI_CUSTOM_METRIC_${n}_UNIT`];

    let params: unknown[] = [];
    const paramsStr = process.env[`SENTINAI_CUSTOM_METRIC_${n}_PARAMS`];
    if (paramsStr) {
      try {
        const parsed = JSON.parse(paramsStr) as unknown;
        params = Array.isArray(parsed) ? parsed : [];
      } catch {
        console.warn(`[SentinAI] Invalid JSON in SENTINAI_CUSTOM_METRIC_${n}_PARAMS: ${paramsStr}`);
      }
    }

    const metric: CustomMetricConfig = { name, displayName, method, params, responsePath };
    if (unit) metric.unit = unit;
    metrics.push(metric);
  }

  return metrics;
}

export interface TopologyConfig {
  components: string[];
  dependencyGraph: Record<string, { dependsOn: string[]; feeds: string[] }>;
}

/**
 * Parse SENTINAI_COMPONENTS and SENTINAI_COMPONENT_DEPS into a topology config.
 * Returns null if neither env var is set, or on JSON parse failure.
 * Never throws.
 */
export function parseTopologyFromEnv(): TopologyConfig | null {
  const componentsStr = process.env.SENTINAI_COMPONENTS;
  const depsStr = process.env.SENTINAI_COMPONENT_DEPS;

  if (!componentsStr && !depsStr) return null;

  const components = componentsStr
    ? componentsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  let dependencyGraph: Record<string, { dependsOn: string[]; feeds: string[] }> = {};
  if (depsStr) {
    try {
      const parsed = JSON.parse(depsStr) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        dependencyGraph = parsed as typeof dependencyGraph;
      } else {
        console.warn('[SentinAI] SENTINAI_COMPONENT_DEPS must be a JSON object');
        return null;
      }
    } catch {
      console.warn(`[SentinAI] Failed to parse SENTINAI_COMPONENT_DEPS: invalid JSON`);
      return null;
    }
  }

  return { components, dependencyGraph };
}

/**
 * Parse SENTINAI_K8S_LABEL_{component} env vars into a component → label selector map.
 * Example: SENTINAI_K8S_LABEL_EXECUTION=app=op-geth → { execution: 'app=op-geth' }
 */
export function parseK8sLabelsFromEnv(): Record<string, string> {
  const labels: Record<string, string> = {};
  const prefix = 'SENTINAI_K8S_LABEL_';

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && value) {
      const component = key.slice(prefix.length).toLowerCase();
      labels[component] = value;
    }
  }

  return labels;
}

/**
 * Convenience: load built-in profile for a given family, then apply env overrides.
 * Falls back to custom empty profile if family is not in BUILTIN_PROFILES.
 */
export function resolveClientProfile(family?: string): ClientProfile {
  const envFamily = getClientFamilyFromEnv();
  const resolvedFamily = envFamily ?? family;
  const allProfiles = mergeWithBuiltins(BUILTIN_PROFILES);
  const base = resolvedFamily ? (allProfiles[resolvedFamily] ?? undefined) : undefined;
  return buildClientProfileFromEnv(base);
}
