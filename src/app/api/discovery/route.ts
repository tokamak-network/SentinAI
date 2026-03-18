export const dynamic = 'force-dynamic';

import { getDiscoveryNetworkInfo, getDiscoveredAgentByAddress, resolveSelfAddress } from '@/lib/agent-marketplace/discovery';
import type { DiscoveryRootResponse } from '@/types/discovery';

export async function GET(): Promise<Response> {
  try {
    const network = await getDiscoveryNetworkInfo();

    let selfAgent = null;
    const selfAddress = resolveSelfAddress();
    if (selfAddress) {
      selfAgent = await getDiscoveredAgentByAddress(selfAddress);
    }

    const body: DiscoveryRootResponse = {
      ok: true,
      network,
      selfAgent,
    };

    return Response.json(body);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Discovery failed' },
      { status: 500 }
    );
  }
}
