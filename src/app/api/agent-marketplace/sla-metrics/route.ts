import { getAgentMarketplaceService } from '@/lib/agent-marketplace/catalog';
import { composeSlaMetricsSnapshot } from '@/lib/agent-marketplace/sla-metrics';
import { withX402 } from '@/lib/agent-marketplace/x402-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withX402(
    request,
    getAgentMarketplaceService('sla_metrics'),
    async () => Response.json(await composeSlaMetricsSnapshot())
  );
}
