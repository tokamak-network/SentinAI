import { NextRequest, NextResponse } from 'next/server';
import { getNonceStore } from '@/lib/nonce-store';

/**
 * GET /api/auth/siwe/nonce?address=0x...
 * Issues a nonce for SIWE signature.
 * Nonce is valid for 5 minutes and tied to a specific address.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address || !address.startsWith('0x') || address.length !== 42) {
      return NextResponse.json(
        { error: 'Invalid address format' },
        { status: 400 }
      );
    }

    const store = getNonceStore();
    const nonce = await store.create(address as `0x${string}`);

    return NextResponse.json({
      nonce,
      expiresIn: 300, // 5 minutes in seconds
    });
  } catch (error) {
    console.error('[Nonce Route] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to issue nonce' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
