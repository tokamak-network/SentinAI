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
 * GET /api/admin/orders/[id]
 * Get a specific order by ID
 * Requires valid admin session
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  try {
    if (!verifyAdminSession(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing session' },
        { status: 401 }
      );
    }

    const store = getMarketplaceStore();
    const order = await store.getOrder(orderId);

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(order);
  } catch (error) {
    console.error('[OrderDetailRoute] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve order' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/orders/[id]
 * Update order status
 * Requires valid admin session
 * Body: { status: 'pending' | 'completed' | 'failed' }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  try {
    if (!verifyAdminSession(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing session' },
        { status: 401 }
      );
    }
    const body = await request.json();
    const { status } = body;

    // Validate status
    if (!status || !['pending', 'completed', 'failed'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid request: status must be pending, completed, or failed' },
        { status: 400 }
      );
    }

    const store = getMarketplaceStore();
    const updatedOrder = await store.updateOrderStatus(orderId, status);

    if (!updatedOrder) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(updatedOrder);
  } catch (error) {
    console.error('[OrderDetailRoute] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update order' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
