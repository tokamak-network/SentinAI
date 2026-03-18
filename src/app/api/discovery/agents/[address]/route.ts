export const dynamic = 'force-dynamic';

import { getDiscoveredAgentByAddress } from '@/lib/agent-marketplace/discovery';
import type { DiscoveryAgentDetailResponse } from '@/types/discovery';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> }
): Promise<Response> {
  const { address } = await params;

  if (!ADDRESS_REGEX.test(address)) {
    const body: DiscoveryAgentDetailResponse = {
      ok: false,
      agent: null,
      error: 'Invalid Ethereum address format',
    };
    return Response.json(body, { status: 400 });
  }

  try {
    const agent = await getDiscoveredAgentByAddress(address);

    if (!agent) {
      const body: DiscoveryAgentDetailResponse = {
        ok: false,
        agent: null,
        error: 'Agent not found',
      };
      return Response.json(body, { status: 404 });
    }

    const body: DiscoveryAgentDetailResponse = {
      ok: true,
      agent,
    };

    return Response.json(body);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        agent: null,
        error: error instanceof Error ? error.message : 'Agent lookup failed',
      },
      { status: 500 }
    );
  }
}
