import { getAgentMarketplaceService } from '@/lib/agent-marketplace/catalog';
import { composeSequencerHealthSnapshot } from '@/lib/agent-marketplace/sequencer-health';
import { withX402 } from '@/lib/agent-marketplace/x402-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withX402(
    request,
    getAgentMarketplaceService('sequencer_health'),
    async () => Response.json(await composeSequencerHealthSnapshot())
  );
}
