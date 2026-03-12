import { getAgentMarketplaceService } from '@/lib/agent-marketplace/catalog';
import { composeIncidentSummarySnapshot } from '@/lib/agent-marketplace/incident-summary';
import { withX402 } from '@/lib/agent-marketplace/x402-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withX402(
    request,
    getAgentMarketplaceService('incident_summary'),
    async () => Response.json(await composeIncidentSummarySnapshot())
  );
}
