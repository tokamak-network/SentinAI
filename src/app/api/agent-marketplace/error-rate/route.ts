import { getAgentMarketplaceService } from '@/lib/agent-marketplace/catalog';
import { composeErrorRateSnapshot } from '@/lib/agent-marketplace/rpc-metrics';
import { withX402 } from '@/lib/agent-marketplace/x402-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withX402(
    request,
    getAgentMarketplaceService('error_rate'),
    async () => Response.json(await composeErrorRateSnapshot())
  );
}
