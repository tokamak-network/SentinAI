import { privateKeyToAddress } from 'viem/accounts';
import { getRegistrationStatus, getRegisteredOperatorAddress } from '@/lib/agent-marketplace/registration-status';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agent-marketplace/ops/operator-info
 * Returns the operator's on-chain identity: wallet address + ERC8004 registration status.
 * Public, unauthenticated. Used by the website marketplace to show the actual registered address.
 *
 * Address resolution order:
 *   1. MARKETPLACE_WALLET_KEY env var (server-managed private key → derives address)
 *   2. OPERATOR_ADDRESS env var (public address, no private key required)
 *   3. Redis-persisted address from last wallet-connect registration
 */
export async function GET(): Promise<Response> {
  const walletKey = process.env.MARKETPLACE_WALLET_KEY?.trim();

  let address: string | null = null;
  if (walletKey) {
    try {
      address = privateKeyToAddress(walletKey as `0x${string}`);
    } catch { /* invalid key */ }
  }

  // Fall back to explicit public address (no private key needed)
  if (!address) {
    const operatorAddress = process.env.OPERATOR_ADDRESS?.trim();
    if (operatorAddress && /^0x[0-9a-fA-F]{40}$/.test(operatorAddress)) {
      address = operatorAddress;
    }
  }

  // Fall back to address saved by save-registration (wallet-connect flow)
  if (!address) {
    address = await getRegisteredOperatorAddress();
  }

  const status = await getRegistrationStatus(address ?? undefined);

  const body = {
    address,
    registered: status.registered,
    agentId: status.registered ? status.agentId : null,
    agentUri: status.registered ? status.agentUri : null,
    contractAddress: status.registered ? status.contractAddress : null,
  };

  return Response.json(body, {
    headers: {
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
