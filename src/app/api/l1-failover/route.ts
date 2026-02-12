/**
 * L1 RPC Failover Status API
 * Returns consolidated L1 RPC failover state for L2 nodes
 */

import { getL1FailoverState } from '@/lib/l1-rpc-failover';
import { maskUrl } from '@/lib/l1-rpc-failover';

export async function GET() {
  try {
    const state = getL1FailoverState();
    const activeEndpoint = state.endpoints[state.activeIndex];

    return Response.json({
      activeUrl: maskUrl(state.activeUrl),
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
