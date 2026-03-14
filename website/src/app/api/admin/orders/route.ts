import { NextRequest, NextResponse } from 'next/server';
import { getMarketplaceStore } from '@/lib/admin-marketplace-store';
import { verifyAdminSessionToken } from '@/lib/admin-session';

// Helper to extract and verify session from cookies
function verifyAdminSession(request: NextRequest): boolean {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return false;

  const cookies = Object.fromEntries(
    cookieHeader.split('; ').map((c) => {
      const [key, ...val] = c.split('=');
      return [key, val.join('=')];
    })
  );

  const sessionToken = cookies['sentinai_admin_session'];
  if (!sessionToken) return false;

  const session = verifyAdminSessionToken(sessionToken);
  return session !== null;
}

/**
 * GET /api/admin/orders
 * Returns paginated list of orders
 * Requires valid admin session
 * Query params: limit (default 50), offset (default 0)
 */
export async function GET(request: NextRequest) {
  try {
    if (!verifyAdminSession(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing session' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);

    const store = getMarketplaceStore();
    const result = await store.getOrders(limit, offset);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[OrdersRoute] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve orders' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
