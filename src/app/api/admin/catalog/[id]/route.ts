/**
 * Catalog Item API routes (PATCH, DELETE)
 * - PATCH: Update an existing catalog agent (status, not tier)
 * - DELETE: Delete a catalog agent
 * - Requires: sentinai_admin_session cookie (validated in middleware)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMarketplaceStore } from '@/lib/marketplace-store';
import type { CatalogAgent } from '@/types/marketplace';
import logger from '@/lib/logger';

interface UpdateCatalogAgentRequest {
  name?: string;
  description?: string;
  status?: 'active' | 'suspended' | 'probation';
  capabilities?: string[];
}

function validateStatus(status: unknown): status is 'active' | 'suspended' | 'probation' {
  return status === 'active' || status === 'suspended' || status === 'probation';
}

function validateUpdateRequest(body: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof body !== 'object' || body === null) {
    errors.push('Request body must be an object');
    return { valid: false, errors };
  }

  const req = body as Record<string, unknown>;

  // Validate name (optional)
  if (req.name !== undefined) {
    if (typeof req.name !== 'string' || !req.name.trim()) {
      errors.push('name must be a non-empty string');
    } else if (req.name.length > 255) {
      errors.push('name must not exceed 255 characters');
    }
  }

  // Validate description (optional)
  if (req.description !== undefined) {
    if (typeof req.description !== 'string' || !req.description.trim()) {
      errors.push('description must be a non-empty string');
    }
  }

  // Validate status (optional)
  if (req.status !== undefined) {
    if (!validateStatus(req.status)) {
      errors.push('status must be one of: active, suspended, probation');
    }
  }

  // Validate capabilities (optional)
  if (req.capabilities !== undefined) {
    if (!Array.isArray(req.capabilities)) {
      errors.push('capabilities must be an array');
    } else if (req.capabilities.length === 0) {
      errors.push('capabilities must not be empty');
    } else if (!req.capabilities.every((cap) => typeof cap === 'string' && cap.trim())) {
      errors.push('capabilities must be an array of non-empty strings');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * PATCH /api/admin/catalog/[id]
 * Updates a catalog agent
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid agent ID' },
        { status: 400 }
      );
    }

    const body = await req.json() as unknown;

    const { valid, errors } = validateUpdateRequest(body);
    if (!valid) {
      return NextResponse.json(
        { success: false, errors },
        { status: 400 }
      );
    }

    const updateReq = body as UpdateCatalogAgentRequest;
    const store = getMarketplaceStore();

    const updates: Partial<Omit<CatalogAgent, 'id' | 'createdAt'>> = {};

    if (updateReq.name !== undefined) {
      updates.name = updateReq.name.trim();
    }
    if (updateReq.description !== undefined) {
      updates.description = updateReq.description.trim();
    }
    if (updateReq.status !== undefined) {
      updates.status = updateReq.status;
    }
    if (updateReq.capabilities !== undefined) {
      updates.capabilities = updateReq.capabilities;
    }

    const updated = await store.updateCatalogAgent(id, updates);

    logger.info('[Catalog API] Agent updated:', {
      id: updated.id,
      name: updated.name,
    });

    return NextResponse.json(
      { success: true, agent: updated },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('not found')) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    logger.error('[Catalog API] Failed to update agent:', message);
    return NextResponse.json(
      { success: false, error: 'Failed to update agent' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/catalog/[id]
 * Deletes a catalog agent
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid agent ID' },
        { status: 400 }
      );
    }

    const store = getMarketplaceStore();
    const deleted = await store.deleteCatalogAgent(id);

    logger.info('[Catalog API] Agent deleted:', {
      id: deleted.id,
      name: deleted.name,
    });

    return NextResponse.json(
      { success: true, agent: deleted },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('not found')) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    logger.error('[Catalog API] Failed to delete agent:', message);
    return NextResponse.json(
      { success: false, error: 'Failed to delete agent' },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS /api/admin/catalog/[id]
 * CORS preflight
 */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Methods': 'PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
