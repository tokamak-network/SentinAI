import {
  clearRegistrationCache,
  saveRegistrationCache,
} from '@/lib/agent-marketplace/registration-status';

export const dynamic = 'force-dynamic';

interface SaveRegistrationBody {
  agentId: string;
  agentUri: string;
  txHash: string;
  registeredAt: string | null;
  contractAddress: string;
  walletAddress: string;
}

/**
 * POST /api/agent-marketplace/ops/save-registration
 *
 * Saves a client-side ERC8004 registration result to the server cache.
 * Called after the browser wallet signs and broadcasts the tx.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as SaveRegistrationBody;

    if (!body.agentId || !body.agentUri || !body.txHash || !body.contractAddress || !body.walletAddress) {
      return Response.json(
        { error: 'Missing required fields: agentId, agentUri, txHash, contractAddress, walletAddress' },
        { status: 400 },
      );
    }

    await clearRegistrationCache(body.walletAddress);
    await saveRegistrationCache(
      {
        registered: true,
        agentId: body.agentId,
        agentUri: body.agentUri,
        txHash: body.txHash,
        registeredAt: body.registeredAt,
        contractAddress: body.contractAddress,
      },
      body.walletAddress,
    );

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to save registration' },
      { status: 500 },
    );
  }
}
