/**
 * GET /api/auth/siwe/nonce?address=0x...
 * Issues a nonce for SIWE signing.
 * Query param: address (user's wallet address)
 */

import { getNonceStore } from '@/lib/nonce-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const address = url.searchParams.get('address') as `0x${string}` | null;

  // Validate address format
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json(
      { error: 'Invalid address format. Expected: 0x + 40 hex chars' },
      { status: 400 }
    );
  }

  try {
    const nonce = await getNonceStore().create(address);
    return Response.json({ nonce }, { status: 200 });
  } catch (error) {
    console.error('[SIWE Nonce] Error creating nonce:', error);
    return Response.json({ error: 'Failed to create nonce' }, { status: 500 });
  }
}
