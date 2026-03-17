/**
 * POST /api/auth/siwe/verify
 * Verifies SIWE message and issues session cookie.
 * Body: { address, signature, message }
 *
 * Only the address matching SENTINAI_ADMIN_ADDRESS can authenticate.
 * The authenticated wallet signs on-chain transactions (e.g. ERC8004
 * registration) directly from the browser.
 */

import { verifyMessage, getAddress } from 'viem';
import { consumeNonce } from '@/lib/nonce-store';
import { getAdminAddress, issueSessionToken, buildSessionCookie } from '@/lib/siwe-session';
import logger from '@/lib/logger';

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (parseError) {
    logger.error('[SIWE Verify] Failed to parse JSON', parseError);
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const { address, signature, message } = body as Record<string, unknown>;

    // Validate input format
    if (!address || typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return Response.json({ error: 'Invalid request' }, { status: 400 });
    }

    if (!signature || typeof signature !== 'string' || !/^0x[a-fA-F0-9]{130}$/.test(signature)) {
      return Response.json({ error: 'Invalid request' }, { status: 400 });
    }

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'Invalid request' }, { status: 400 });
    }

    const addressLower = address.toLowerCase() as `0x${string}`;

    // Step 1: Extract and validate nonce from message
    const nonceMatch = message.match(/Nonce:\s+([a-f0-9]{64})/i);
    if (!nonceMatch) {
      logger.warn('[SIWE Verify] Nonce not found in message');
      return Response.json({ error: 'Invalid request' }, { status: 400 });
    }
    const nonce = nonceMatch[1];

    // Step 2: Consume nonce (1-use pattern, atomic)
    const nonceValid = await consumeNonce(addressLower, nonce);
    if (!nonceValid) {
      logger.warn('[SIWE Verify] Invalid or expired nonce for address', { address: addressLower });
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Step 3: Verify signature using viem
    let isValid: boolean;
    try {
      isValid = await verifyMessage({
        address: addressLower,
        message,
        signature: signature as `0x${string}`,
      });
    } catch (error) {
      logger.error('[SIWE Verify] Signature verification failed:', error);
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    if (!isValid) {
      logger.warn('[SIWE Verify] Signature verification returned false', { address: addressLower });
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Step 4: Check if signer is the designated admin
    const signerAddress = getAddress(addressLower);
    const adminAddress = getAdminAddress();
    if (!adminAddress) {
      logger.warn('[SIWE Verify] SENTINAI_ADMIN_ADDRESS not set — admin login disabled');
      return Response.json({ error: 'Admin login not configured' }, { status: 403 });
    }
    if (signerAddress.toLowerCase() !== adminAddress.toLowerCase()) {
      logger.warn('[SIWE Verify] Address not authorized', {
        signer: signerAddress,
        admin: adminAddress,
      });
      return Response.json({ error: 'Address not authorized' }, { status: 403 });
    }

    // Step 5: Issue session token and set cookie
    const sessionToken = issueSessionToken(signerAddress);
    const response = Response.json(
      { ok: true, message: 'Session created successfully' },
      { status: 200 }
    );
    response.headers.set('Set-Cookie', buildSessionCookie(sessionToken));

    logger.info('[SIWE Verify] Session created for address', { address: signerAddress });
    return response;
  } catch (error) {
    logger.error('[SIWE Verify] Request processing error:', error);
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
}
