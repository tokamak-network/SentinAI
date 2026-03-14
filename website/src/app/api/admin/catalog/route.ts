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
 * GET /api/admin/catalog
 * Returns list of agents in the marketplace
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

    return NextResponse.json({
      agents: data.agents,
      total: data.agents.length,
    });
  } catch (error) {
    console.error('[CatalogRoute] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve catalog' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/catalog
 * Create a new agent
 * Requires valid admin session
 * Body: { name, description, imageUrl?, status }
 */
export async function POST(request: NextRequest) {
  try {
    if (!verifyAdminSession(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing session' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, description, imageUrl, status } = body;

    // Validate required fields
    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request: name is required' },
        { status: 400 }
      );
    }

    if (!description || typeof description !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request: description is required' },
        { status: 400 }
      );
    }

    if (!status || !['active', 'inactive'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid request: status must be active or inactive' },
        { status: 400 }
      );
    }

    const store = getMarketplaceStore();
    const agentId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const newAgent = await store.addAgent({
      id: agentId,
      name,
      description,
      imageUrl: imageUrl || undefined,
      status,
    });

    return NextResponse.json(newAgent, { status: 201 });
  } catch (error) {
    console.error('[CatalogRoute] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create agent' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
