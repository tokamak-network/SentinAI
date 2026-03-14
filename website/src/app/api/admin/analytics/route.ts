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
 * GET /api/admin/analytics
 * Returns marketplace analytics and statistics
 * Requires valid admin session
 */
export async function GET(request: NextRequest) {
  try {
    if (!verifyAdminSession(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing session' },
        { status: 401 }
      );
    }

    const store = getMarketplaceStore();
    const data = await store.getData();

    // Calculate statistics
    const totalAgents = data.agents.length;
    const activeAgents = data.agents.filter(a => a.status === 'active').length;
    const inactiveAgents = data.agents.filter(a => a.status === 'inactive').length;

    const totalOrders = data.orders.length;
    const pendingOrders = data.orders.filter(o => o.status === 'pending').length;
    const completedOrders = data.orders.filter(o => o.status === 'completed').length;
    const failedOrders = data.orders.filter(o => o.status === 'failed').length;

    const totalRevenue = data.orders
      .filter(o => o.status === 'completed')
      .reduce((sum, o) => sum + o.amount, 0);

    const ordersByTier = {
      trainee: data.orders.filter(o => o.tier === 'trainee').length,
      junior: data.orders.filter(o => o.tier === 'junior').length,
      senior: data.orders.filter(o => o.tier === 'senior').length,
      expert: data.orders.filter(o => o.tier === 'expert').length,
    };

    const revenueByTier = {
      trainee: data.orders
        .filter(o => o.tier === 'trainee' && o.status === 'completed')
        .reduce((sum, o) => sum + o.amount, 0),
      junior: data.orders
        .filter(o => o.tier === 'junior' && o.status === 'completed')
        .reduce((sum, o) => sum + o.amount, 0),
      senior: data.orders
        .filter(o => o.tier === 'senior' && o.status === 'completed')
        .reduce((sum, o) => sum + o.amount, 0),
      expert: data.orders
        .filter(o => o.tier === 'expert' && o.status === 'completed')
        .reduce((sum, o) => sum + o.amount, 0),
    };

    // Order activity over last 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentOrders = data.orders.filter(
      o => new Date(o.createdAt).getTime() > sevenDaysAgo
    );

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      agents: {
        total: totalAgents,
        active: activeAgents,
        inactive: inactiveAgents,
      },
      orders: {
        total: totalOrders,
        pending: pendingOrders,
        completed: completedOrders,
        failed: failedOrders,
        byTier: ordersByTier,
        recent7Days: recentOrders.length,
      },
      revenue: {
        total: totalRevenue,
        byTier: revenueByTier,
      },
      pricing: data.pricing,
    });
  } catch (error) {
    console.error('[AnalyticsRoute] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve analytics' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
