import { registerOpsData } from '@/lib/agent-marketplace/ops-registry';
import {
  clearRegistrationCache,
  saveRegistrationCache,
} from '@/lib/agent-marketplace/registration-status';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent-marketplace/ops/register-ops
 *
 * Registers the ops-snapshot.json endpoint URI to the Sepolia ERC8004 registry.
 * Requires env: MARKETPLACE_AGENT_URI_BASE, MARKETPLACE_WALLET_KEY,
 *               ERC8004_REGISTRY_ADDRESS, SENTINAI_L1_RPC_URL
 */
export async function POST(): Promise<Response> {
  const walletKey = process.env.MARKETPLACE_WALLET_KEY?.trim() ?? '';
  const registryAddress = process.env.ERC8004_REGISTRY_ADDRESS?.trim() ?? '';
  const agentUriBase = process.env.MARKETPLACE_AGENT_URI_BASE?.trim() ?? '';

  const result = await registerOpsData({
    agentUriBase,
    walletKey,
    registryAddress,
  });

  if (result.ok) {
    await clearRegistrationCache();
    await saveRegistrationCache({
      registered: true,
      agentId: result.agentId,
      agentUri: result.opsUri,
      txHash: result.txHash,
      registeredAt: result.registeredAt,
      contractAddress: registryAddress,
    });
  }

  return Response.json({ result }, { status: result.ok ? 200 : 502 });
}
