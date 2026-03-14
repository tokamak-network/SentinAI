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
 * GET /api/admin/pricing
 * Returns current pricing policy
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
    const pricing = await store.getPricing();

    return NextResponse.json(pricing);
  } catch (error) {
    console.error('[PricingRoute] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve pricing' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/pricing
 * Update pricing policy
 * Requires valid admin session
 * Body: { trainee?, junior?, senior?, expert? } (all in USD cents)
 */
export async function PUT(request: NextRequest) {
  try {
    if (!verifyAdminSession(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing session' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { trainee, junior, senior, expert } = body;

    // Validate pricing fields
    const updates: Record<string, number> = {};

    if (trainee !== undefined) {
      if (!Number.isInteger(trainee) || trainee < 0) {
        return NextResponse.json(
          { error: 'Invalid request: trainee must be a non-negative integer (USD cents)' },
          { status: 400 }
        );
      }
      updates.trainee = trainee;
    }

    if (junior !== undefined) {
      if (!Number.isInteger(junior) || junior < 0) {
        return NextResponse.json(
          { error: 'Invalid request: junior must be a non-negative integer (USD cents)' },
          { status: 400 }
        );
      }
      updates.junior = junior;
    }

    if (senior !== undefined) {
      if (!Number.isInteger(senior) || senior < 0) {
        return NextResponse.json(
          { error: 'Invalid request: senior must be a non-negative integer (USD cents)' },
          { status: 400 }
        );
      }
      updates.senior = senior;
    }

    if (expert !== undefined) {
      if (!Number.isInteger(expert) || expert < 0) {
        return NextResponse.json(
          { error: 'Invalid request: expert must be a non-negative integer (USD cents)' },
          { status: 400 }
        );
      }
      updates.expert = expert;
    }

    // Ensure at least one field is being updated
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'Invalid request: at least one pricing tier must be specified' },
        { status: 400 }
      );
    }

    const store = getMarketplaceStore();
    const updatedPricing = await store.updatePricing(updates);

    return NextResponse.json(updatedPricing);
  } catch (error) {
    console.error('[PricingRoute] PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to update pricing' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
