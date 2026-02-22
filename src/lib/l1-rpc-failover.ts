/**
 * L1 RPC Auto-Failover Module (L2 Nodes)
 * Manages L2 node L1 RPC endpoints with automatic failover.
 * Detects failures, switches to healthy backup, and updates K8s components.
 * Monitors Proxyd backends for repeated probe failures and auto-replaces with spare URLs.
 */

import { createPublicClient, http } from 'viem';
import { getChainPlugin } from '@/chains';
import TOML from '@iarna/toml';
import { runK8sCommand, getNamespace, getAppPrefix } from '@/lib/k8s-config';
import { isDockerMode } from '@/lib/docker-config';
import { setDockerEnvAndRecreate } from '@/lib/docker-orchestrator';
import type {
  L1RpcEndpoint,
  FailoverEvent,
  L1FailoverState,
  L1ComponentConfig,
  K8sUpdateResult,
  ConfigMapUpdateResult,
  BackendReplacementEvent,
  L2NodeL1RpcStatus,
} from '@/types/l1-failover';

// ============================================================
// Constants
// ============================================================

/** Consecutive failures before triggering failover (general errors) */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Default consecutive probe failures before triggering Proxyd backend replacement */
const MAX_CONSECUTIVE_FAILURES_429 = 10;

/** Minimum interval between failovers (ms) */
const FAILOVER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/** Health check timeout (ms) */
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

/** Max failover events to keep */
const MAX_FAILOVER_EVENTS = 20;

/** Max backend replacement events to keep */
const MAX_REPLACEMENT_EVENTS = 20;

/** Default public fallback endpoint */
const DEFAULT_PUBLIC_ENDPOINT = 'https://ethereum-sepolia-rpc.publicnode.com';

// ============================================================
// K8s Component Config
// ============================================================

/**
 * Returns the K8s app prefix used for StatefulSet names, labels, and ConfigMaps.
 * Unified with K8S_APP_PREFIX (previously separate K8S_STATEFULSET_PREFIX).
 */
function getStatefulSetPrefix(): string {
  return getAppPrefix();
}

function parseUrlList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
}

function getDefaultL1RpcUrl(): string {
  return DEFAULT_PUBLIC_ENDPOINT;
}

// ============================================================
// Proxyd ConfigMap Name Resolution
// ============================================================

let proxydConfigMapNameCache: string | null = null;
let warnedDeprecatedSentinaiL1Rpc = false;
let warnedMissingL2FailoverPool = false;

/**
 * Resolve Proxyd ConfigMap name with fallback chain:
 * 1. L1_PROXYD_CONFIGMAP_NAME env var (explicit)
 * 2. Auto-detect from cluster (kubectl get configmap, filter "proxyd")
 * 3. Fallback to 'proxyd-config'
 */
export async function resolveProxydConfigMapName(): Promise<string> {
  if (process.env.L1_PROXYD_CONFIGMAP_NAME) {
    return process.env.L1_PROXYD_CONFIGMAP_NAME;
  }

  if (proxydConfigMapNameCache) return proxydConfigMapNameCache;

  try {
    const namespace = getNamespace();
    const { stdout } = await runK8sCommand(
      `get configmap -n ${namespace} --no-headers -o custom-columns=":metadata.name"`,
      { timeout: 10000 }
    );
    const configMaps = stdout.trim().split('\n').filter(Boolean);
    const proxydCm = configMaps.find(name =>
      name.toLowerCase().includes('proxyd') && !name.startsWith('kube-')
    );
    if (proxydCm) {
      proxydConfigMapNameCache = proxydCm;
      console.info(`[L1 Failover] Auto-detected Proxyd ConfigMap: ${proxydCm}`);
      return proxydCm;
    }
  } catch {
    // kubectl not available or cluster not connected
  }

  return 'proxyd-config';
}

// ============================================================
// Proxyd ConfigMap Support
// ============================================================

/**
 * Replace a specific backend's URL in Proxyd TOML config.
 * Works with actual Proxyd structure: [backends.NAME] nested tables.
 */
export function replaceBackendInToml(
  tomlContent: string,
  backendName: string,
  newRpcUrl: string
): { updatedToml: string; previousUrl: string } {
  let parsed: Record<string, unknown>;

  try {
    parsed = TOML.parse(tomlContent) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`TOML parse failed: ${message}`);
  }

  const backends = parsed.backends as Record<string, Record<string, unknown>> | undefined;
  if (!backends || typeof backends !== 'object') {
    throw new Error('TOML missing [backends] section');
  }

  const backend = backends[backendName];
  if (!backend) {
    throw new Error(`Backend "${backendName}" not found in TOML [backends]`);
  }

  const previousUrl = backend.rpc_url as string;
  backend.rpc_url = newRpcUrl;

  // Update ws_url if present (https→wss, http→ws)
  if (backend.ws_url) {
    backend.ws_url = newRpcUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  }

  const updatedToml = TOML.stringify(parsed as TOML.JsonMap);
  return { updatedToml, previousUrl };
}

/**
 * Get current ConfigMap TOML content
 */
export async function getConfigMapToml(
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
    // Escape dots in dataKey for jsonpath (e.g., proxyd-config.toml → proxyd-config\.toml)
    const escapedKey = dataKey.replace(/\./g, '\\.');
    const jsonPath = `{.data.${escapedKey}}`;
    const cmd = `get configmap ${configMapName} -n ${namespace} -o jsonpath='${jsonPath}'`;
    const { stdout } = await runK8sCommand(cmd, { timeout: 10000 });

    const content = stdout.trim();

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
 * Restart Proxyd to pick up ConfigMap changes.
 *
 * NOTE: Different Helm charts label Proxyd pods differently. In our EKS setup,
 * proxyd pods are labeled like: app=<prefix>-l1-proxyd (e.g., sepolia-thanos-stack-l1-proxyd)
 * not app=proxyd.
 */
async function restartProxydPod(namespace: string): Promise<boolean> {
  const prefix = getStatefulSetPrefix();
  const deploymentName = `${prefix}-l1-proxyd`;

  // 1) Prefer a clean rollout restart (works for Deployments)
  try {
    const cmd = `rollout restart deployment/${deploymentName} -n ${namespace}`;
    await runK8sCommand(cmd, { timeout: 15000 });
    console.info(`[L1 Failover] Restarted Proxyd via rollout: ${deploymentName} (${namespace})`);
    return true;
  } catch {
    // Fall through to delete-pod strategy
  }

  // 2) Fallback: delete pods by label (works if controller recreates pods)
  try {
    const labelSelector = `app=${deploymentName}`;
    const cmd = `delete pod -l ${labelSelector} -n ${namespace}`;
    await runK8sCommand(cmd, { timeout: 15000 });

    console.info(`[L1 Failover] Restarted Proxyd pod(s) via delete: -l ${labelSelector} (${namespace})`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn(
      `[L1 Failover] Failed to restart Proxyd (${deploymentName}) in ${namespace}: ${errorMessage} ` +
        `(ConfigMap update applied, but pod restart may be needed manually)`
    );
    return false;
  }
}

/**
 * Apply a backend URL replacement to Proxyd ConfigMap and restart pod.
 */
async function applyBackendReplacement(
  backendName: string,
  newUrl: string
): Promise<ConfigMapUpdateResult> {
  const configMapName = await resolveProxydConfigMapName();
  const dataKey = process.env.L1_PROXYD_DATA_KEY || 'proxyd-config.toml';
  const namespace = getNamespace();

  try {
    // 1. Read current TOML
    const currentToml = await getConfigMapToml(configMapName, dataKey, namespace);

    // 2. Replace backend URL
    const { updatedToml, previousUrl } = replaceBackendInToml(currentToml, backendName, newUrl);

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

    console.info(
      `[L1 Failover] Updated Proxyd backend ${backendName}: ${maskUrl(previousUrl)} → ${maskUrl(newUrl)}`
    );

    // 4. Restart Proxyd pod to apply ConfigMap changes
    await restartProxydPod(namespace);

    return {
      success: true,
      configMapName,
      previousUrl,
      newUrl,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[L1 Failover] Failed to replace backend ${backendName}: ${errorMessage}`);
    return {
      success: false,
      configMapName,
      error: errorMessage,
    };
  }
}

/** Components that need L1 RPC env var updates (built from chain plugin) */
export function getL1Components(): L1ComponentConfig[] {
  const prefix = getStatefulSetPrefix();
  const plugin = getChainPlugin();

  // StatefulSets with L1 RPC env var — Proxyd backend replacement handled separately
  return plugin.k8sComponents
    .filter(c => c.l1RpcEnvVar)
    .map(c => ({
      type: 'statefulset' as const,
      statefulSetName: `${prefix}-${c.statefulSetSuffix}`,
      envVarName: c.l1RpcEnvVar!,
    }));
}

// ============================================================
// State (globalThis singleton for Next.js HMR survival)
// ============================================================

const globalForFailover = globalThis as unknown as {
  __sentinai_l1_failover?: L1FailoverState;
};

function initFromEnv(): L1FailoverState {
  const urls = parseUrlList(process.env.L1_RPC_URLS);
  if (urls.length === 0) {
    urls.push(getDefaultL1RpcUrl());
    if (!warnedMissingL2FailoverPool) {
      console.warn(
        '[L1 Failover] L1_RPC_URLS is not configured. L2 failover pool defaults to a single public endpoint.'
      );
      warnedMissingL2FailoverPool = true;
    }
  }

  const endpoints: L1RpcEndpoint[] = urls.map((url) => ({
    url,
    healthy: true,
    lastSuccess: null,
    lastFailure: null,
    consecutiveFailures: 0,
  }));

  // Parse spare URLs for Proxyd backend 429 replacement (unified into L1_RPC_URLS)
  const spareUrls: string[] = [];
  const spareUrlsList = process.env.L1_RPC_URLS || process.env.L1_PROXYD_SPARE_URLS;
  if (process.env.L1_PROXYD_SPARE_URLS && !process.env.L1_RPC_URLS) {
    console.warn('[L1 Failover] L1_PROXYD_SPARE_URLS is deprecated — use L1_RPC_URLS instead');
  }
  spareUrls.push(...parseUrlList(spareUrlsList));

  return {
    activeUrl: endpoints[0].url,
    activeIndex: 0,
    endpoints,
    lastFailoverTime: null,
    events: [],
    proxydHealth: [],
    backendReplacements: [],
    spareUrls,
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
 * Source of truth for L2 node failover routing.
 */
export function getActiveL1RpcUrl(): string {
  return getState().activeUrl;
}

/**
 * Get SentinAI internal L1 RPC URL used for app-level reads/monitoring.
 * This is intentionally separated from L2 node failover pool (L1_RPC_URLS).
 */
export function getSentinaiL1RpcUrl(): string {
  const sentinaiUrl = process.env.SENTINAI_L1_RPC_URL?.trim();
  if (sentinaiUrl) return sentinaiUrl;

  const deprecatedUrl = process.env.L1_RPC_URL?.trim();
  if (deprecatedUrl) {
    if (!warnedDeprecatedSentinaiL1Rpc) {
      console.warn('[L1 Failover] L1_RPC_URL is deprecated — use SENTINAI_L1_RPC_URL instead.');
      warnedDeprecatedSentinaiL1Rpc = true;
    }
    return deprecatedUrl;
  }

  return getDefaultL1RpcUrl();
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
      chain: getChainPlugin().l1Chain,
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

    console.info(
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

    console.info(
      `[L1 Failover] Switched: ${maskUrl(fromUrl)} → ${maskUrl(candidate.url)} (reason: ${reason})`
    );

    // Update K8s components (skip StatefulSet env patch when Proxyd handles L1 routing)
    const isProxydMode = process.env.L1_PROXYD_ENABLED === 'true';
    const k8sResult = isProxydMode
      ? { updated: [] as string[], errors: [] as string[] }
      : await updateK8sL1Rpc(candidate.url);

    const event: FailoverEvent = {
      timestamp: new Date().toISOString(),
      fromUrl: maskUrl(fromUrl),
      toUrl: maskUrl(candidate.url),
      reason,
      k8sUpdated: k8sResult.updated.length > 0,
      k8sComponents: k8sResult.updated,
      simulated: false,
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
 * Switch active L1 RPC URL to a specific endpoint.
 * Adds the endpoint to state if it does not exist.
 */
export async function setActiveL1RpcUrl(
  newUrl: string,
  reason: string
): Promise<FailoverEvent | null> {
  const trimmed = newUrl.trim();
  if (!trimmed) {
    return null;
  }

  const state = getState();
  const fromUrl = state.activeUrl;

  let targetIndex = state.endpoints.findIndex((endpoint) => endpoint.url === trimmed);
  if (targetIndex < 0) {
    state.endpoints.push({
      url: trimmed,
      healthy: true,
      lastSuccess: null,
      lastFailure: null,
      consecutiveFailures: 0,
    });
    targetIndex = state.endpoints.length - 1;
  }

  const healthy = await healthCheckEndpoint(trimmed);
  if (!healthy) {
    const endpoint = state.endpoints[targetIndex];
    endpoint.healthy = false;
    endpoint.lastFailure = Date.now();
    endpoint.consecutiveFailures++;
    return null;
  }

  state.activeUrl = trimmed;
  state.activeIndex = targetIndex;
  state.lastFailoverTime = Date.now();

  const endpoint = state.endpoints[targetIndex];
  endpoint.healthy = true;
  endpoint.lastSuccess = Date.now();
  endpoint.consecutiveFailures = 0;

  const isProxydMode = process.env.L1_PROXYD_ENABLED === 'true';
  const k8sResult = isProxydMode
    ? { updated: [] as string[], errors: [] as string[] }
    : await updateK8sL1Rpc(trimmed);

  const event: FailoverEvent = {
    timestamp: new Date().toISOString(),
    fromUrl: maskUrl(fromUrl),
    toUrl: maskUrl(trimmed),
    reason,
    k8sUpdated: k8sResult.updated.length > 0,
    k8sComponents: k8sResult.updated,
    simulated: false,
  };

  state.events.push(event);
  if (state.events.length > MAX_FAILOVER_EVENTS) {
    state.events.shift();
  }

  return event;
}

/**
 * Update K8s StatefulSet components with new L1 RPC URL.
 */
export async function updateK8sL1Rpc(
  newUrl: string
): Promise<K8sUpdateResult> {
  const result: K8sUpdateResult = { updated: [], errors: [] };

  // Docker mode: update .env and recreate services
  if (isDockerMode()) {
    const components = getL1Components();
    for (const comp of components) {
      try {
        if (comp.envVarName) {
          await setDockerEnvAndRecreate(comp.statefulSetName || comp.envVarName, {
            [comp.envVarName]: newUrl,
          });
          result.updated.push(comp.statefulSetName || comp.envVarName);
          console.info(`[L1 Failover] Docker: Updated ${comp.envVarName}`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`${comp.statefulSetName}: ${msg}`);
      }
    }
    return result;
  }

  if (!hasK8sCluster()) {
    console.info(
      '[L1 Failover] No K8s cluster configured, skipping component update'
    );
    return result;
  }

  const namespace = getNamespace();
  const components = getL1Components();

  for (const comp of components) {
    try {
      if (comp.type === 'statefulset' && comp.statefulSetName && comp.envVarName) {
        const cmd = `set env statefulset/${comp.statefulSetName} -n ${namespace} ${comp.envVarName}=${newUrl}`;
        await runK8sCommand(cmd, { timeout: 15000 });
        result.updated.push(comp.statefulSetName);
        console.info(
          `[L1 Failover] Updated ${comp.statefulSetName} ${comp.envVarName}`
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`${comp.statefulSetName}: ${msg}`);
      console.error(
        `[L1 Failover] Failed to update ${comp.statefulSetName}: ${msg}`
      );
    }
  }

  return result;
}

// ============================================================
// Proxyd Backend Health Monitoring
// ============================================================

/**
 * Probe a single RPC endpoint with raw fetch to get HTTP status code.
 * Returns { ok, status } where status is the HTTP status code (429 for quota).
 */
export async function probeBackend(url: string): Promise<{ ok: boolean; status?: number }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false };
  }
}

/**
 * Check all Proxyd backends in the target group for probe failures.
 * When a backend accumulates repeated failures (429, 5xx, timeout/network),
 * replace its URL with the next spare URL.
 * Threshold can be tuned with L1_PROXYD_REPLACEMENT_THRESHOLD (default: 10).
 *
 * Called from agent-loop every cycle (scheduler interval, currently 60s).
 */
export async function checkProxydBackends(): Promise<BackendReplacementEvent | null> {
  if (process.env.L1_PROXYD_ENABLED !== 'true') return null;

  const state = getState();
  const replacementThreshold = parsePositiveInt(
    process.env.L1_PROXYD_REPLACEMENT_THRESHOLD,
    MAX_CONSECUTIVE_FAILURES_429
  );
  const configMapName = await resolveProxydConfigMapName();
  const dataKey = process.env.L1_PROXYD_DATA_KEY || 'proxyd-config.toml';
  const targetGroup = process.env.L1_PROXYD_UPSTREAM_GROUP || 'main';
  const namespace = getNamespace();

  // 1. Read ConfigMap TOML
  let tomlContent: string;
  try {
    tomlContent = await getConfigMapToml(configMapName, dataKey, namespace);
  } catch (error) {
    console.warn(`[L1 Failover] Cannot read Proxyd ConfigMap: ${error instanceof Error ? error.message : error}`);
    return null;
  }

  // 2. Parse backends and backend_groups
  let parsed: Record<string, unknown>;
  try {
    parsed = TOML.parse(tomlContent) as Record<string, unknown>;
  } catch {
    return null;
  }

  const backends = parsed.backends as Record<string, Record<string, unknown>> | undefined;
  const backendGroups = parsed.backend_groups as Record<string, Record<string, unknown>> | undefined;
  if (!backends || !backendGroups) return null;

  const group = backendGroups[targetGroup] as { backends?: string[] } | undefined;
  if (!group?.backends || !Array.isArray(group.backends)) return null;

  // 3. Probe each backend in the target group
  for (const backendName of group.backends) {
    const backend = backends[backendName];
    if (!backend?.rpc_url) continue;

    const rpcUrl = backend.rpc_url as string;

    // Find or create health tracking entry
    let health = state.proxydHealth.find((h) => h.name === backendName);
    if (!health) {
      health = {
        name: backendName,
        rpcUrl,
        consecutiveFailures: 0,
        healthy: true,
        replaced: false,
      };
      state.proxydHealth.push(health);
    }

    // Skip already-replaced backends
    if (health.replaced) continue;

    // Sync URL (may have changed externally)
    health.rpcUrl = rpcUrl;

    const probe = await probeBackend(rpcUrl);
    health.lastChecked = Date.now();

    if (isProxydFailoverCandidate(probe)) {
      health.consecutiveFailures++;
      health.healthy = false;
      console.warn(
        `[L1 Failover] Backend ${backendName} probe failed (${describeProbeFailure(probe)}): ${health.consecutiveFailures}/${replacementThreshold}`
      );

      if (health.consecutiveFailures >= replacementThreshold) {
        // Threshold reached — replace with spare URL
        if (state.spareUrls.length === 0) {
          console.error(
            `[L1 Failover] Backend ${backendName} needs replacement but no spare URLs available (L1_RPC_URLS)`
          );
          return null;
        }

        const spareUrl = state.spareUrls.shift()!;

        const result = await applyBackendReplacement(backendName, spareUrl);
        if (!result.success) {
          // Put spare URL back on failure
          state.spareUrls.unshift(spareUrl);
          return null;
        }

        health.replaced = true;
        health.replacedWith = spareUrl;
        health.consecutiveFailures = 0;

        const event: BackendReplacementEvent = {
          timestamp: new Date().toISOString(),
          backendName,
          oldUrl: maskUrl(rpcUrl),
          newUrl: maskUrl(spareUrl),
          reason: `${replacementThreshold} consecutive backend probe failures (${describeProbeFailure(probe)})`,
          simulated: false,
        };

        state.backendReplacements.push(event);
        if (state.backendReplacements.length > MAX_REPLACEMENT_EVENTS) {
          state.backendReplacements.shift();
        }

        return event;
      }
    } else if (probe.ok) {
      // Reset failure counter on successful probe
      health.consecutiveFailures = 0;
      health.healthy = true;
    } else {
      // Non-failover statuses (e.g. 4xx except 429) mark unhealthy but do not trigger replacement
      health.healthy = false;
    }
  }

  return null;
}

/**
 * Manually replace a proxyd backend URL.
 */
export interface ManualBackendReplacementResult {
  success: boolean;
  backendName: string;
  previousUrl?: string;
  newUrl?: string;
  event?: BackendReplacementEvent;
  error?: string;
}

export async function replaceProxydBackendUrl(
  backendName: string,
  newUrl: string,
  reason: string
): Promise<ManualBackendReplacementResult> {
  const trimmedBackend = backendName.trim();
  const trimmedUrl = newUrl.trim();
  if (!trimmedBackend || !trimmedUrl) {
    return {
      success: false,
      backendName: trimmedBackend || backendName,
      error: 'backendName/newUrl is required',
    };
  }

  const result = await applyBackendReplacement(trimmedBackend, trimmedUrl);
  if (!result.success || !result.previousUrl || !result.newUrl) {
    return {
      success: false,
      backendName: trimmedBackend,
      error: result.error || 'backend replacement failed',
    };
  }

  const state = getState();
  const event: BackendReplacementEvent = {
    timestamp: new Date().toISOString(),
    backendName: trimmedBackend,
    oldUrl: maskUrl(result.previousUrl),
    newUrl: maskUrl(result.newUrl),
    reason,
    simulated: false,
  };

  state.backendReplacements.push(event);
  if (state.backendReplacements.length > MAX_REPLACEMENT_EVENTS) {
    state.backendReplacements.shift();
  }

  const health = state.proxydHealth.find((item) => item.name === trimmedBackend);
  if (health) {
    health.rpcUrl = trimmedUrl;
    health.replaced = true;
    health.replacedWith = trimmedUrl;
    health.consecutiveFailures = 0;
    health.healthy = true;
    health.lastChecked = Date.now();
  }

  return {
    success: true,
    backendName: trimmedBackend,
    previousUrl: result.previousUrl,
    newUrl: result.newUrl,
    event,
  };
}

// ============================================================
// State Accessors
// ============================================================

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
  warnedDeprecatedSentinaiL1Rpc = false;
  warnedMissingL2FailoverPool = false;
}

// ============================================================
// Internal Helpers
// ============================================================

// L1 failover is NOT gated by SCALING_SIMULATION_MODE.
// Only K8s scaling operations are affected by simulation mode.

function hasK8sCluster(): boolean {
  return !!(process.env.AWS_CLUSTER_NAME || process.env.K8S_API_URL);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
}

function isProxydFailoverCandidate(probe: { ok: boolean; status?: number }): boolean {
  if (probe.status === 429) return true;
  if (typeof probe.status === 'number' && probe.status >= 500) return true;
  if (!probe.ok && probe.status === undefined) return true; // timeout/network
  return false;
}

function describeProbeFailure(probe: { ok: boolean; status?: number }): string {
  if (probe.status === undefined) return 'timeout-or-network';
  return `HTTP ${probe.status}`;
}

// ============================================================
// L2 Nodes L1 RPC Status
// ============================================================

/**
 * Get L2 nodes' L1 RPC endpoint status
 * Supports both Proxyd (ConfigMap) and Direct (StatefulSet env var) modes
 */
export async function getL2NodesL1RpcStatus(): Promise<L2NodeL1RpcStatus[]> {
  const isProxydEnabled = process.env.L1_PROXYD_ENABLED === 'true';

  try {
    if (isProxydEnabled) {
      return await getL2NodesL1RpcFromProxyd();
    } else {
      return await getL2NodesL1RpcFromK8s();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[getL2NodesL1RpcStatus] Failed:', message);
    return []; // Graceful degradation
  }
}

/**
 * Path A: Get L2 nodes L1 RPC from Proxyd ConfigMap
 * All L2 components share the same upstream backend
 */
async function getL2NodesL1RpcFromProxyd(): Promise<L2NodeL1RpcStatus[]> {
  try {
    // 1. Get ConfigMap TOML content
    const configMapName = await resolveProxydConfigMapName();
    const tomlContent = await getConfigMapToml(
      configMapName,
      process.env.L1_PROXYD_DATA_KEY || 'proxyd-config.toml',
      getNamespace()
    );

    // 2. Parse TOML
    const parsed = TOML.parse(tomlContent) as Record<string, unknown>;
    const backends = parsed.backends as Record<string, Record<string, unknown>>;
    const backendGroups = parsed.backend_groups as Record<string, Record<string, unknown>>;
    const upstreamGroup = process.env.L1_PROXYD_UPSTREAM_GROUP || 'main';
    const group = backendGroups[upstreamGroup] as { backends?: string[] };
    const backendNames = group.backends || [];

    // 3. Extract first backend RPC URL (all L2 components share)
    const firstBackendUrl = backendNames[0] ? (backends[backendNames[0]]?.rpc_url as string) : null;

    // 4. Get health status from existing checks
    const state = getL1FailoverState();
    const healthMap = new Map(
      state.proxydHealth.map(h => [h.rpcUrl, h.healthy])
    );

    // 5. Generate status for L2 components with L1 RPC dependency
    const plugin = getChainPlugin();
    return plugin.k8sComponents
      .filter(c => c.l1RpcEnvVar)
      .map(c => ({
        component: c.component,
        l1RpcUrl: maskUrl(firstBackendUrl || 'unknown'),
        healthy: healthMap.get(firstBackendUrl || '') ?? false,
      }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (process.env.DEBUG_K8S === 'true') {
      console.error('[getL2NodesL1RpcFromProxyd] Failed:', message);
    }
    return [];
  }
}

/**
 * Resolve the actual L1 RPC URL from Proxyd ConfigMap.
 * Reads TOML config and extracts the first backend's rpc_url.
 */
async function resolveProxydBackend(
  namespace: string,
  prefix: string
): Promise<string> {
  try {
    // 1. Get Proxyd ConfigMap TOML content
    const proxydConfigMap = `${prefix}-l1-proxyd`;
    // Escape dots in key name for jsonpath (proxyd-config.toml -> proxyd-config\.toml)
    const cmd = `get configmap ${proxydConfigMap} -n ${namespace} -o jsonpath='{.data.proxyd-config\\.toml}'`;
    const { stdout } = await runK8sCommand(cmd, { timeout: 10000 });
    const tomlContent = stdout.trim();

    if (!tomlContent) {
      throw new Error('Empty Proxyd ConfigMap TOML');
    }

    // 2. Parse TOML
    const parsed = TOML.parse(tomlContent) as Record<string, unknown>;
    const backends = parsed.backends as Record<string, Record<string, unknown>>;
    const backendGroups = parsed.backend_groups as Record<string, Record<string, unknown>>;

    // 3. Get first backend name from 'main' group
    const mainGroup = backendGroups.main as { backends?: string[] };
    const backendNames = mainGroup?.backends || [];
    const firstBackendName = backendNames[0];

    if (!firstBackendName) {
      throw new Error('No backends configured in Proxyd main group');
    }

    // 4. Extract rpc_url
    const backend = backends[firstBackendName];
    const rpcUrl = backend?.rpc_url as string;

    if (!rpcUrl) {
      throw new Error(`Backend ${firstBackendName} has no rpc_url`);
    }

    console.info(`[L1 Failover] Resolved Proxyd backend: ${firstBackendName} → ${maskUrl(rpcUrl)}`);
    return rpcUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[resolveProxydBackend] Failed: ${message}`);
    throw error;
  }
}

/**
 * Path B: Get L2 nodes L1 RPC from K8s ConfigMaps
 * Each component has its own L1_ETH_RPC in its ConfigMap
 * May use Proxyd as a proxy, requiring dereferencing
 */
async function getL2NodesL1RpcFromK8s(): Promise<L2NodeL1RpcStatus[]> {
  try {
    const namespace = getNamespace();
    const prefix = getAppPrefix();
    const plugin = getChainPlugin();
    const components = plugin.k8sComponents
      .filter(c => c.l1RpcEnvVar)
      .map(c => ({ name: c.component, configMapKey: c.l1RpcEnvVar! }));

    // Fetch all component L1 RPC URLs in parallel
    const results = await Promise.all(
      components.map(async ({ name, configMapKey }) => {
        try {
          // Step 1: Read component ConfigMap
          const configMapName = `${prefix}-${name}`;
          const cmd = `get configmap ${configMapName} -n ${namespace} -o jsonpath='{.data.${configMapKey}}'`;
          const { stdout } = await runK8sCommand(cmd, { timeout: 10000 });
          const rawUrl = stdout.replace(/^'|'$/g, '').trim();

          if (!rawUrl) {
            return {
              component: name as L2NodeL1RpcStatus['component'],
              l1RpcUrl: 'N/A',
              healthy: false,
            };
          }

          // Step 2: Check if Proxyd (contains 'proxyd' in hostname)
          let finalUrl = rawUrl;
          if (rawUrl.includes('proxyd')) {
            finalUrl = await resolveProxydBackend(namespace, prefix);
          }

          // Step 3: Health check
          const client = createPublicClient({
            chain: getChainPlugin().l1Chain,
            transport: http(finalUrl, { timeout: 5000 }),
          });
          await client.getBlockNumber();

          return {
            component: name as L2NodeL1RpcStatus['component'],
            l1RpcUrl: maskUrl(finalUrl),
            healthy: true,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[getL2NodesL1RpcFromK8s] Failed for ${name}: ${message}`);
          return {
            component: name as L2NodeL1RpcStatus['component'],
            l1RpcUrl: 'Error',
            healthy: false,
          };
        }
      })
    );

    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[getL2NodesL1RpcFromK8s] Failed:', message);
    return [];
  }
}
