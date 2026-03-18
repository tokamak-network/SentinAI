import { getAgentMarketplaceService } from '@/lib/agent-marketplace/catalog';
import { composeHealthDiagnosticsSnapshot } from '@/lib/agent-marketplace/health-diagnostics';
import { withX402 } from '@/lib/agent-marketplace/x402-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withX402(
    request,
    getAgentMarketplaceService('health_diagnostics'),
    async () => Response.json(await composeHealthDiagnosticsSnapshot())
  );
}
