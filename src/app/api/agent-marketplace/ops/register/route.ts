import { registerAgentMarketplaceIdentity } from '@/lib/agent-marketplace/agent-registry';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  _context?: Record<string, unknown>
): Promise<Response> {
  const result = await registerAgentMarketplaceIdentity({
    agentUriBase: process.env.MARKETPLACE_AGENT_URI_BASE?.trim() ?? '',
    walletKey: process.env.MARKETPLACE_WALLET_KEY?.trim() ?? '',
    registryAddress: process.env.ERC8004_REGISTRY_ADDRESS?.trim() ?? '',
  });

  return Response.json(
    { result },
    {
      status: result.ok ? 200 : 502,
    }
  );
}
