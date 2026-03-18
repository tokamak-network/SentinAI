import { getAgentMarketplaceService } from '@/lib/agent-marketplace/catalog';
import { composeDerivationLagSnapshot } from '@/lib/agent-marketplace/derivation-lag';
import { withX402 } from '@/lib/agent-marketplace/x402-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withX402(
    request,
    getAgentMarketplaceService('derivation_lag'),
    async () => Response.json(await composeDerivationLagSnapshot())
  );
}
