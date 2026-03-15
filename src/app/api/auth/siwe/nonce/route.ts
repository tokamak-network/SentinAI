/**
 * GET /api/auth/siwe/nonce?address=0x...
 * Issues a nonce for SIWE signing.
 * Query param: address (user's wallet address)
 * Response: { address, nonce, expiresIn }
 */

import { createNonce } from '@/lib/nonce-store';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

const NONCE_EXPIRES_IN = 300; // 5 minutes in seconds

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const address = url.searchParams.get('address') as `0x${string}` | null;

  // Validate address format
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json(
      { error: 'Missing or invalid address parameter' },
      { status: 400 }
    );
  }

  try {
    const nonce = await createNonce(address);
    return Response.json(
      {
        address,
        nonce,
        expiresIn: NONCE_EXPIRES_IN,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[SIWE Nonce] Error creating nonce:', message);
    return Response.json({ error: 'Failed to create nonce' }, { status: 500 });
  }
}
