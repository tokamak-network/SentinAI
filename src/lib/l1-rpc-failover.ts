/**
 * L1 RPC Auto-Failover Module
 * Manages multiple L1 RPC endpoints with automatic failover.
 * Detects failures, switches to healthy backup, and updates K8s components.
 */

import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import TOML from '@iarna/toml';
import { runK8sCommand, getNamespace } from '@/lib/k8s-config';
import type {
  L1RpcEndpoint,
  FailoverEvent,
  L1FailoverState,
  L1ComponentConfig,
  K8sUpdateResult,
  ProxydConfig,
  TomlUpstream,
  ConfigMapUpdateResult,
} from '@/types/l1-failover';

// ============================================================
// Constants
// ============================================================

/** Consecutive failures before triggering failover (general errors) */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Consecutive 429 (quota exhausted) failures before triggering failover */
const MAX_CONSECUTIVE_FAILURES_429 = 10;

/** Minimum interval between failovers (ms) */
const FAILOVER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/** Health check timeout (ms) */
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

/** Max failover events to keep */
const MAX_FAILOVER_EVENTS = 20;

/** Default public fallback endpoint */
const DEFAULT_PUBLIC_ENDPOINT = 'https://ethereum-sepolia-rpc.publicnode.com';

// ============================================================
// K8s Component Config
// ============================================================

function getStatefulSetPrefix(): string {
  return process.env.K8S_STATEFULSET_PREFIX || 'sepolia-thanos-stack';
}

// ============================================================
// Proxyd ConfigMap Support
// ============================================================

/**
 * Parse TOML content and update upstream URL + backends
 * Proxyd uses upstreams (named RPC endpoints) and backends (references to upstreams)
 * Both must be updated for the change to take effect.
 */
function updateTomlUpstream(
  tomlContent: string,
  upstreamGroup: string,
  newUrl: string,
  mode: 'replace' | 'append' = 'replace'
): { updatedToml: string; previousUrl: string | null } {
  let parsedToml: any;

  try {
    parsedToml = TOML.parse(tomlContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`TOML parse failed: ${message}`);
  }

  if (!parsedToml.upstreams || !Array.isArray(parsedToml.upstreams)) {
    throw new Error('TOML missing [[upstreams]] section');
  }

  const upstreams = parsedToml.upstreams as TomlUpstream[];
  const targetIndex = upstreams.findIndex((u) => u.name === upstreamGroup);

  if (targetIndex === -1) {
    throw new Error(`Upstream group "${upstreamGroup}" not found in TOML`);
  }

  const previousUrl = upstreams[targetIndex].rpc_url;

  if (mode === 'replace') {
    // Simple replace: Update the existing upstream URL + WS URL
    upstreams[targetIndex].rpc_url = newUrl;
    if (upstreams[targetIndex].ws_url) {
      // Update WS URL similarly (convert https to wss)
      upstreams[targetIndex].ws_url = newUrl.replace(/^https?:/, 'wss:').replace(/^http:/, 'ws:');
    }
  } else {
    // Append mode: Add new upstream, rename old to fallback
    const timestamp = Date.now();
    upstreams[targetIndex].name = `${upstreamGroup}-backup-${timestamp}`;
    upstreams.splice(targetIndex, 0, {
      name: upstreamGroup,
      rpc_url: newUrl,
      ws_url: newUrl.replace(/^https?:/, 'wss:').replace(/^http:/, 'ws:'),
    });
  }

  parsedToml.upstreams = upstreams;

  // Also update backends if they reference this upstream by name
  // backends.[backend_name].rpc_url and ws_url should match upstream names
  if (parsedToml.backends && Array.isArray(parsedToml.backends)) {
    for (const backend of parsedToml.backends) {
      if (backend.rpc_url === upstreamGroup || backend.rpc_url === (upstreams[targetIndex].name)) {
        backend.rpc_url = upstreamGroup;
      }
      if (backend.ws_url === upstreamGroup || backend.ws_url === (upstreams[targetIndex].name)) {
        backend.ws_url = upstreamGroup;
      }
    }
  }

  // Serialize back to TOML
  const updatedToml = TOML.stringify(parsedToml);
  return { updatedToml, previousUrl };
}

/**
 * Get current ConfigMap TOML content
 */
async function getConfigMapToml(
  configMapName: string,
  dataKey: string,
  namespace: string
): Promise<string> {
  // Security: Validate identifiers
  if (!/^[a-zA-Z0-9._-]+$/.test(configMapName)) {
    throw new Error(`Invalid ConfigMap name: ${configMapName}`);
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(dataKey)) {
    throw new Error(`Invalid data key: ${dataKey}`);
  }

  try {
    const jsonPath = `{.data['${dataKey}']}`;
    const cmd = `get configmap ${configMapName} -n ${namespace} -o jsonpath='${jsonPath}'`;
    const { stdout } = await runK8sCommand(cmd, { timeout: 10000 });

    const content = stdout.replace(/^'|'$/g, '').trim();

    if (!content) {
      throw new Error(`ConfigMap ${configMapName} has empty ${dataKey}`);
    }

    return content;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to get ConfigMap: ${message}`);
  }
}

/**
 * Restart Proxyd pod to pick up ConfigMap changes
 */
async function restartProxydPod(namespace: string): Promise<boolean> {
  try {
    // Delete Proxyd pod to trigger restart (K8s will respawn via Deployment/StatefulSet)
    const cmd = `delete pod -l app=proxyd -n ${namespace}`;
    await runK8sCommand(cmd, { timeout: 10000 });

    console.log(`[L1 Failover] Restarted Proxyd pod(s) in namespace ${namespace}`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[L1 Failover] Failed to restart Proxyd pod: ${errorMessage} (ConfigMap update applied, but pod restart may be needed manually)`);
    return false;
  }
}

/**
 * Update Proxyd ConfigMap with new L1 RPC URL
 * IMPORTANT: Proxyd pod must restart to pick up ConfigMap changes
 */
async function updateProxydConfigMap(
  configMapName: string,
  dataKey: string,
  upstreamGroup: string,
  newUrl: string,
  namespace: string,
  mode: 'replace' | 'append' = 'replace'
): Promise<ConfigMapUpdateResult> {
  try {
    // 1. Read current TOML
    const currentToml = await getConfigMapToml(configMapName, dataKey, namespace);

    // 2. Parse and update upstreams + backends
    const { updatedToml, previousUrl } = updateTomlUpstream(
      currentToml,
      upstreamGroup,
      newUrl,
      mode
    );

    // 3. Apply via kubectl patch (JSON patch)
    const patchJson = JSON.stringify([
      {
        op: 'replace',
        path: `/data/${dataKey}`,
        value: updatedToml,
      },
    ]);

    const cmd = `patch configmap ${configMapName} -n ${namespace} --type='json' -p='${patchJson}'`;
    await runK8sCommand(cmd, { timeout: 15000 });

    console.log(
      `[L1 Failover] Updated Proxyd ConfigMap ${configMapName}/${dataKey}: ${maskUrl(previousUrl || '')} → ${maskUrl(newUrl)}`
    );

    // 4. Restart Proxyd pod to apply ConfigMap changes
    const podRestartSuccess = await restartProxydPod(namespace);

    return {
      success: true,
      configMapName,
      previousUrl: previousUrl || undefined,
      newUrl,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[L1 Failover] Failed to update Proxyd ConfigMap: ${errorMessage}`);
    return {
      success: false,
      configMapName,
      error: errorMessage,
    };
  }
}

/** Components that need L1 RPC env var updates */
export function getL1Components(): L1ComponentConfig[] {
  const proxydEnabled = process.env.L1_PROXYD_ENABLED === 'true';
  const prefix = getStatefulSetPrefix();

  if (proxydEnabled) {
    // Proxyd mode: ConfigMap first, then StatefulSets
    return [
      // Priority 1: Proxyd ConfigMap
      {
        type: 'proxyd',
        proxydConfig: {
          configMapName: process.env.L1_PROXYD_CONFIGMAP_NAME || 'proxyd-config',
          dataKey: process.env.L1_PROXYD_DATA_KEY || 'proxyd.toml',
          upstreamGroup: process.env.L1_PROXYD_UPSTREAM_GROUP || 'main',
          updateMode: (process.env.L1_PROXYD_UPDATE_MODE as 'replace' | 'append') || 'replace',
        },
      },
      // Priority 2-4: StatefulSets
      { type: 'statefulset', statefulSetName: `${prefix}-op-node`, envVarName: 'OP_NODE_L1_ETH_RPC' },
      { type: 'statefulset', statefulSetName: `${prefix}-op-batcher`, envVarName: 'OP_BATCHER_L1_ETH_RPC' },
      { type: 'statefulset', statefulSetName: `${prefix}-op-proposer`, envVarName: 'OP_PROPOSER_L1_ETH_RPC' },
    ];
  } else {
    // Legacy mode: StatefulSets only
    return [
      { type: 'statefulset', statefulSetName: `${prefix}-op-node`, envVarName: 'OP_NODE_L1_ETH_RPC' },
      { type: 'statefulset', statefulSetName: `${prefix}-op-batcher`, envVarName: 'OP_BATCHER_L1_ETH_RPC' },
      { type: 'statefulset', statefulSetName: `${prefix}-op-proposer`, envVarName: 'OP_PROPOSER_L1_ETH_RPC' },
    ];
  }
}

// ============================================================
// State (globalThis singleton for Next.js HMR survival)
// ============================================================

const globalForFailover = globalThis as unknown as {
  __sentinai_l1_failover?: L1FailoverState;
};

function initFromEnv(): L1FailoverState {
  const urls: string[] = [];

  // Priority 1: L1_RPC_URLS (comma-separated)
  const urlsList = process.env.L1_RPC_URLS;
  if (urlsList) {
    urls.push(
      ...urlsList
        .split(',')
        .map((u) => u.trim())
        .filter((u) => u.length > 0)
    );
  }

  // Priority 2: L1_RPC_URL (single)
  const singleUrl = process.env.L1_RPC_URL;
  if (singleUrl && !urls.includes(singleUrl)) {
    urls.push(singleUrl);
  }

  // Priority 3: Default public endpoint (always last)
  if (!urls.includes(DEFAULT_PUBLIC_ENDPOINT)) {
    urls.push(DEFAULT_PUBLIC_ENDPOINT);
  }

  const endpoints: L1RpcEndpoint[] = urls.map((url) => ({
    url,
    healthy: true,
    lastSuccess: null,
    lastFailure: null,
    consecutiveFailures: 0,
  }));

  return {
    activeUrl: endpoints[0].url,
    activeIndex: 0,
    endpoints,
    lastFailoverTime: null,
    events: [],
  };
}

function getState(): L1FailoverState {
  if (!globalForFailover.__sentinai_l1_failover) {
    globalForFailover.__sentinai_l1_failover = initFromEnv();
  }
  return globalForFailover.__sentinai_l1_failover;
}

// ============================================================
// URL Masking (security: hide API keys in URLs)
// ============================================================

export function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    // Show first 30 chars of path if present
    const path = parsed.pathname.length > 1 ? parsed.pathname.substring(0, 15) + '...' : '';
    return `${parsed.protocol}//${host}${path}`;
  } catch {
    return url.length > 30 ? url.substring(0, 30) + '...' : url;
  }
}

// ============================================================
// Core API
// ============================================================

/**
 * Get the currently active L1 RPC URL.
 * Single source of truth — all L1 RPC consumers should use this.
 */
export function getActiveL1RpcUrl(): string {
  return getState().activeUrl;
}

/**
 * Report a successful L1 RPC call.
 */
export function reportL1Success(): void {
  const state = getState();
  const endpoint = state.endpoints[state.activeIndex];
  if (endpoint) {
    endpoint.healthy = true;
    endpoint.lastSuccess = Date.now();
    endpoint.consecutiveFailures = 0;
  }
}

/**
 * Report a failed L1 RPC call.
 * Triggers failover if consecutive failures exceed threshold.
 * HTTP 429 (quota exhaustion) uses higher threshold (10) than other errors (3).
 * Returns new URL if failover occurred, null otherwise.
 */
export async function reportL1Failure(
  error: Error
): Promise<string | null> {
  const state = getState();
  const endpoint = state.endpoints[state.activeIndex];
  if (endpoint) {
    endpoint.lastFailure = Date.now();
    endpoint.consecutiveFailures++;
  }

  // Determine threshold based on error type
  const errorMessage = error.message.toLowerCase();
  const is429Error = errorMessage.includes('429') || errorMessage.includes('too many requests') || errorMessage.includes('quota');
  const threshold = is429Error ? MAX_CONSECUTIVE_FAILURES_429 : MAX_CONSECUTIVE_FAILURES;

  // Check if failover is needed
  if (
    !endpoint ||
    endpoint.consecutiveFailures < threshold
  ) {
    return null;
  }

  // Check cooldown
  if (
    state.lastFailoverTime &&
    Date.now() - state.lastFailoverTime < FAILOVER_COOLDOWN_MS
  ) {
    console.warn(
      `[L1 Failover] Cooldown active, ${Math.ceil((FAILOVER_COOLDOWN_MS - (Date.now() - state.lastFailoverTime)) / 1000)}s remaining`
    );
    return null;
  }

  // Only one endpoint — nothing to fail over to
  if (state.endpoints.length <= 1) {
    return null;
  }

  // Mark current as unhealthy
  endpoint.healthy = false;

  const reason = `${endpoint.consecutiveFailures} consecutive failures: ${error.message}`;
  const event = await executeFailover(reason);
  return event ? event.toUrl : null;
}

/**
 * Health check a specific L1 RPC endpoint.
 * Calls eth_blockNumber with timeout.
 */
export async function healthCheckEndpoint(url: string): Promise<boolean> {
  try {
    const client = createPublicClient({
      chain: sepolia,
      transport: http(url, { timeout: HEALTH_CHECK_TIMEOUT_MS }),
    });
    const blockNumber = await client.getBlockNumber();
    return blockNumber > BigInt(0);
  } catch {
    return false;
  }
}

/**
 * Execute failover to the next healthy endpoint.
 */
export async function executeFailover(
  reason: string
): Promise<FailoverEvent | null> {
  const state = getState();
  const fromUrl = state.activeUrl;
  const startIndex = state.activeIndex;

  // Try each endpoint after the current one (wrap around)
  for (let i = 1; i < state.endpoints.length; i++) {
    const candidateIndex =
      (startIndex + i) % state.endpoints.length;
    const candidate = state.endpoints[candidateIndex];

    console.log(
      `[L1 Failover] Checking candidate: ${maskUrl(candidate.url)}`
    );

    const isHealthy = await healthCheckEndpoint(candidate.url);
    if (!isHealthy) {
      candidate.healthy = false;
      candidate.lastFailure = Date.now();
      continue;
    }

    // Found a healthy endpoint — switch
    candidate.healthy = true;
    candidate.lastSuccess = Date.now();
    candidate.consecutiveFailures = 0;

    state.activeUrl = candidate.url;
    state.activeIndex = candidateIndex;
    state.lastFailoverTime = Date.now();

    console.log(
      `[L1 Failover] Switched: ${maskUrl(fromUrl)} → ${maskUrl(candidate.url)} (reason: ${reason})`
    );

    // Update K8s components
    const k8sResult = await updateK8sL1Rpc(candidate.url);

    const event: FailoverEvent = {
      timestamp: new Date().toISOString(),
      fromUrl: maskUrl(fromUrl),
      toUrl: maskUrl(candidate.url),
      reason,
      k8sUpdated: k8sResult.updated.length > 0,
      k8sComponents: k8sResult.updated,
      simulated: isSimulationMode(),
    };

    // Push to ring buffer
    state.events.push(event);
    if (state.events.length > MAX_FAILOVER_EVENTS) {
      state.events.shift();
    }

    return event;
  }

  console.error(
    '[L1 Failover] All endpoints unhealthy, cannot failover'
  );
  return null;
}

/**
 * Update K8s components with new L1 RPC URL.
 * Supports both legacy (StatefulSet-only) and Proxyd (ConfigMap + StatefulSet) modes.
 */
export async function updateK8sL1Rpc(
  newUrl: string
): Promise<K8sUpdateResult> {
  const result: K8sUpdateResult = { updated: [], errors: [] };

  if (isSimulationMode()) {
    const components = getL1Components();
    console.log(
      `[L1 Failover] [SIMULATION] Would update ${components.length} K8s components to ${maskUrl(newUrl)}`
    );
    return result;
  }

  if (!hasK8sCluster()) {
    console.log(
      '[L1 Failover] No K8s cluster configured, skipping component update'
    );
    return result;
  }

  const namespace = getNamespace();
  const components = getL1Components();

  for (const comp of components) {
    try {
      if (comp.type === 'proxyd' && comp.proxydConfig) {
        // Update Proxyd ConfigMap
        const cmResult = await updateProxydConfigMap(
          comp.proxydConfig.configMapName,
          comp.proxydConfig.dataKey,
          comp.proxydConfig.upstreamGroup,
          newUrl,
          namespace,
          comp.proxydConfig.updateMode
        );

        result.configMapResult = cmResult;

        if (cmResult.success) {
          result.updated.push(`configmap/${comp.proxydConfig.configMapName}`);
        } else {
          // Log error but CONTINUE to StatefulSets
          result.errors.push(`configmap/${comp.proxydConfig.configMapName}: ${cmResult.error}`);
          console.warn(
            `[L1 Failover] Proxyd ConfigMap update failed, continuing with StatefulSets: ${cmResult.error}`
          );
        }
      } else if (comp.type === 'statefulset' && comp.statefulSetName && comp.envVarName) {
        // Update StatefulSet env var (legacy method)
        const cmd = `set env statefulset/${comp.statefulSetName} -n ${namespace} ${comp.envVarName}=${newUrl}`;
        await runK8sCommand(cmd, { timeout: 15000 });
        result.updated.push(comp.statefulSetName);
        console.log(
          `[L1 Failover] Updated ${comp.statefulSetName} ${comp.envVarName}`
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const identifier = comp.type === 'proxyd'
        ? `configmap/${comp.proxydConfig?.configMapName}`
        : comp.statefulSetName;
      result.errors.push(`${identifier}: ${msg}`);
      console.error(
        `[L1 Failover] Failed to update ${identifier}: ${msg}`
      );
    }
  }

  return result;
}

/**
 * Get current failover state (for API/dashboard).
 */
export function getL1FailoverState(): L1FailoverState {
  return getState();
}

/**
 * Get recent failover events.
 */
export function getFailoverEvents(): FailoverEvent[] {
  return [...getState().events];
}

/**
 * Reset state (for testing).
 */
export function resetL1FailoverState(): void {
  globalForFailover.__sentinai_l1_failover = undefined;
}

// ============================================================
// Internal Helpers
// ============================================================

function isSimulationMode(): boolean {
  return process.env.SCALING_SIMULATION_MODE !== 'false';
}

function hasK8sCluster(): boolean {
  return !!(process.env.AWS_CLUSTER_NAME || process.env.K8S_API_URL);
}
