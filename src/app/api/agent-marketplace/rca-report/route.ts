import { getAgentMarketplaceService } from '@/lib/agent-marketplace/catalog';
import { composeRCAReportSnapshot } from '@/lib/agent-marketplace/rca-report';
import { withX402 } from '@/lib/agent-marketplace/x402-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withX402(
    request,
    getAgentMarketplaceService('rca_report'),
    async () => Response.json(await composeRCAReportSnapshot())
  );
}
