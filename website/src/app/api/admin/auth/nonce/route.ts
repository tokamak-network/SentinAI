import { NextRequest, NextResponse } from 'next/server';
import { getAdminNonceStore } from '@/lib/admin-nonce-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    // Validate address format
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json(
        { error: 'Invalid address format' },
        { status: 400 }
      );
    }

    // Generate and store nonce
    const nonceStore = getAdminNonceStore();
    const nonce = await nonceStore.create(address as `0x${string}`);

    return NextResponse.json({ nonce });
  } catch (error) {
    console.error('[Admin Nonce API] Error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
