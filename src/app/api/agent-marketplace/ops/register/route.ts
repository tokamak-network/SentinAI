import { registerAgentMarketplaceIdentity } from '@/lib/agent-marketplace/agent-registry';
import {
  clearRegistrationCache,
  saveRegistrationCache,
} from '@/lib/agent-marketplace/registration-status';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  _context?: Record<string, unknown>
): Promise<Response> {
  const walletKey = process.env.MARKETPLACE_WALLET_KEY?.trim() ?? '';
  const registryAddress = process.env.ERC8004_REGISTRY_ADDRESS?.trim() ?? '';
  const agentUriBase = process.env.MARKETPLACE_AGENT_URI_BASE?.trim() ?? '';

  const result = await registerAgentMarketplaceIdentity({
    agentUriBase,
    walletKey,
    registryAddress,
  });

  if (result.ok) {
    await clearRegistrationCache();
    await saveRegistrationCache({
      registered: true,
      agentId: result.agentId,
      agentUri: `${agentUriBase.replace(/\/+$/, '')}/api/agent-marketplace/agent.json`,
      txHash: result.txHash,
      registeredAt: result.registeredAt,
      contractAddress: registryAddress,
    });
  }

  return Response.json(
    { result },
    { status: result.ok ? 200 : 502 }
  );
}
