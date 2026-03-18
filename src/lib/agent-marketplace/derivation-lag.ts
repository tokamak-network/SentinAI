import { checkDerivationLag } from '@/lib/derivation-lag-monitor';
import type { DerivationLagSnapshot } from '@/types/agent-marketplace';

export async function composeDerivationLagSnapshot(): Promise<DerivationLagSnapshot> {
  const rpcUrl = process.env.L2_RPC_URL ?? '';
  const result = await checkDerivationLag(rpcUrl);
  return result;
}
