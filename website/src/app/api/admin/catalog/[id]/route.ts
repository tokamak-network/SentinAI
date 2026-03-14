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
 * PUT /api/admin/catalog/[id]
 * Update an agent
 * Requires valid admin session
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;
  try {
    if (!verifyAdminSession(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing session' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, description, imageUrl, status } = body;

    // Validate update fields
    const updates: Record<string, unknown> = {};
    if (name !== undefined) {
      if (typeof name !== 'string') {
        return NextResponse.json(
          { error: 'Invalid request: name must be a string' },
          { status: 400 }
        );
      }
      updates.name = name;
    }

    if (description !== undefined) {
      if (typeof description !== 'string') {
        return NextResponse.json(
          { error: 'Invalid request: description must be a string' },
          { status: 400 }
        );
      }
      updates.description = description;
    }

    if (imageUrl !== undefined) {
      if (typeof imageUrl !== 'string') {
        return NextResponse.json(
          { error: 'Invalid request: imageUrl must be a string' },
          { status: 400 }
        );
      }
      updates.imageUrl = imageUrl;
    }

    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        return NextResponse.json(
          { error: 'Invalid request: status must be active or inactive' },
          { status: 400 }
        );
      }
      updates.status = status;
    }

    const store = getMarketplaceStore();
    const updatedAgent = await store.updateAgent(agentId, updates as any);

    if (!updatedAgent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(updatedAgent);
  } catch (error) {
    console.error('[CatalogRoute] PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to update agent' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/catalog/[id]
 * Delete an agent
 * Requires valid admin session
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;
  try {
    if (!verifyAdminSession(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing session' },
        { status: 401 }
      );
    }

    const store = getMarketplaceStore();
    const deleted = await store.deleteAgent(agentId);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[CatalogRoute] DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete agent' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
