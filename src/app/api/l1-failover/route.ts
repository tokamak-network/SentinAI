/**
 * L1 RPC Failover Status API
 * Returns consolidated L1 RPC failover state for L2 nodes (via Proxyd)
 */

import { getL1FailoverState, getConfigMapToml } from '@/lib/l1-rpc-failover';
import { maskUrl } from '@/lib/l1-rpc-failover';
import { getNamespace } from '@/lib/k8s-config';
import TOML from '@iarna/toml';

export async function GET() {
  try {
    const state = getL1FailoverState();
    const activeEndpoint = state.endpoints[state.activeIndex];

    // Get Proxyd active backend URL for L2 nodes
    let proxydActiveUrl = 'unknown';
    try {
      const namespace = getNamespace();
      const configMapName = process.env.L1_PROXYD_CONFIGMAP_NAME || 'proxyd-config';
      const dataKey = process.env.L1_PROXYD_DATA_KEY || 'proxyd-config.toml';

      if (process.env.L1_PROXYD_ENABLED === 'true') {
        // Import getConfigMapToml is not directly available, so we'll read directly
        const tomlContent = await getConfigMapToml(configMapName, dataKey, namespace);
        const parsed = TOML.parse(tomlContent) as Record<string, unknown>;

        const backendGroups = parsed.backend_groups as Record<string, Record<string, unknown>>;
        const mainGroup = backendGroups.main as { backends?: string[] };
        const backendNames = mainGroup?.backends || [];
        const firstBackendName = backendNames[0];

        if (firstBackendName) {
          const backends = parsed.backends as Record<string, Record<string, unknown>>;
          const backend = backends[firstBackendName];
          const rpcUrl = backend?.rpc_url as string;
          if (rpcUrl) {
            proxydActiveUrl = rpcUrl;
          }
        }
      }
    } catch {
      // Fall back to empty if Proxyd config not available
    }

    return Response.json({
      activeUrl: maskUrl(proxydActiveUrl),
      failoverCount: state.endpoints.length,
      spareUrlCount: state.spareUrls.length,
      healthy: activeEndpoint?.healthy ?? false,
      lastFailover: state.events[0]?.timestamp || null,
      lastFailoverReason: state.events[0]?.reason || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[L1 Failover API] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
