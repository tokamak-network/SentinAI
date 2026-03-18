import { getAgentMarketplaceService } from '@/lib/agent-marketplace/catalog';
import { composeAnomalyFeedSnapshot } from '@/lib/agent-marketplace/anomaly-feed';
import { withX402 } from '@/lib/agent-marketplace/x402-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withX402(
    request,
    getAgentMarketplaceService('anomaly_feed'),
    async () => Response.json(await composeAnomalyFeedSnapshot())
  );
}
