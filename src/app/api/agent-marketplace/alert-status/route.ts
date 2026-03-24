import { getAgentMarketplaceService } from '@/lib/agent-marketplace/catalog';
import { composeAlertStatusSnapshot } from '@/lib/agent-marketplace/alert-status';
import { withX402 } from '@/lib/agent-marketplace/x402-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withX402(
    request,
    getAgentMarketplaceService('alert_status'),
    async () => Response.json(await composeAlertStatusSnapshot())
  );
}
