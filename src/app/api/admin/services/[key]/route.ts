/**
 * Admin Services API — per-service update
 * PATCH /api/admin/services/:key — update price (amount) and/or state
 */

import { NextRequest, NextResponse } from 'next/server';
import { agentMarketplaceServiceKeys } from '@/types/agent-marketplace';
import type { AgentMarketplaceServiceKey } from '@/types/agent-marketplace';
import { setServiceOverride } from '@/lib/agent-marketplace/service-catalog-store';
import logger from '@/lib/logger';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
): Promise<NextResponse> {
  const { key } = await params;

  if (!agentMarketplaceServiceKeys.includes(key as AgentMarketplaceServiceKey)) {
    return NextResponse.json(
      { success: false, error: `Unknown service key: ${key}` },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ success: false, error: 'Body must be an object' }, { status: 400 });
  }

  const { amount, state } = body as Record<string, unknown>;

  if (amount !== undefined) {
    if (typeof amount !== 'string' || !/^\d+$/.test(amount)) {
      return NextResponse.json(
        { success: false, error: 'amount must be a non-negative integer string (TON wei)' },
        { status: 400 }
      );
    }
  }

  if (state !== undefined && state !== 'active' && state !== 'planned') {
    return NextResponse.json(
      { success: false, error: 'state must be "active" or "planned"' },
      { status: 400 }
    );
  }

  try {
    await setServiceOverride(key as AgentMarketplaceServiceKey, {
      ...(amount !== undefined ? { amount: amount as string } : {}),
      ...(state !== undefined ? { state: state as 'active' | 'planned' } : {}),
    });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    logger.error('[Admin Services PATCH]', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ success: false, error: 'Failed to update service (Redis required)' }, { status: 503 });
  }
}
