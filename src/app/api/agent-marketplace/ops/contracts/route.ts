import { getAgentMarketplaceContractsStatus } from '@/lib/agent-marketplace/contracts-status';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json(getAgentMarketplaceContractsStatus());
}
