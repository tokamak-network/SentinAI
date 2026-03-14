/**
 * POST /api/auth/siwe/verify
 * Verifies SIWE message and issues session cookie.
 * Body: { address, signature, message }
 * Response: { ok: true } with Set-Cookie header
 */

import { verifyMessage } from 'viem';
import { getAddress } from 'viem';
import { getNonceStore } from '@/lib/nonce-store';
import { getAdminAddress, issueSessionToken, buildSessionCookie } from '@/lib/siwe-session';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { address, signature, message } = body;

    // Validate input format
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return Response.json({ error: 'Invalid address format' }, { status: 400 });
    }

    if (!signature || !/^0x[a-fA-F0-9]{130}$/.test(signature)) {
      return Response.json({ error: 'Invalid signature format' }, { status: 400 });
    }

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'Invalid message' }, { status: 400 });
    }

    // Step 1: Extract and validate nonce from message
    const nonceMatch = message.match(/Nonce: ([a-f0-9]{32})/i);
    if (!nonceMatch) {
      return Response.json({ error: 'Nonce not found in message' }, { status: 400 });
    }
    const nonce = nonceMatch[1];

    // Step 2: Consume nonce (1-use pattern)
    const nonceValid = await getNonceStore().consume(address as `0x${string}`, nonce);
    if (!nonceValid) {
      return Response.json(
        { error: 'Invalid or expired nonce' },
        { status: 401 }
      );
    }

    // Step 3: Verify signature using viem
    let isValid: boolean;
    try {
      isValid = await verifyMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
    } catch (error) {
      console.error('[SIWE Verify] Signature verification failed:', error);
      return Response.json({ error: 'Signature verification failed' }, { status: 401 });
    }

    if (!isValid) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Step 4: Check if signer is admin
    const adminAddress = getAdminAddress();
    if (!adminAddress) {
      console.error('[SIWE Verify] Admin address not configured');
      return Response.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Normalize addresses for comparison
    const signerAddress = getAddress(address as `0x${string}`);
    const normalizedAdmin = getAddress(adminAddress);

    if (signerAddress.toLowerCase() !== normalizedAdmin.toLowerCase()) {
      return Response.json(
        { error: 'Not authorized to access marketplace admin' },
        { status: 403 }
      );
    }

    // Step 5: Issue session token and set cookie
    const sessionToken = issueSessionToken(signerAddress);
    const response = Response.json({ ok: true }, { status: 200 });
    response.headers.set('Set-Cookie', buildSessionCookie(sessionToken));

    return response;
  } catch (error) {
    console.error('[SIWE Verify] Request processing error:', error);
    return Response.json({ error: 'Request processing failed' }, { status: 500 });
  }
}
