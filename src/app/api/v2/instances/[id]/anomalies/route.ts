/**
 * v2 Instance Anomalies Endpoint
 * GET → Anomaly events filtered by instanceId
 *
 * Uses the existing anomaly-event-store with client-side filtering
 * since the current store does not natively support instanceId filters.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import { getEvents } from '@/lib/anomaly-event-store';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;

  try {
    const instance = await getInstance(id);
    if (!instance) {
      return NextResponse.json(
        { error: 'Instance not found.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const url = new URL(request.url);
    const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)), 100);
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

    // Fetch from global store (fetch a large batch to apply instanceId filter)
    const result = await getEvents(200, 0);

    // Filter by instanceId — AnomalyEvent may not always carry instanceId,
    // so we also include events without instanceId (they belong to the default instance)
    const filtered = result.events.filter(
      (ev) =>
        // explicit match
        (ev as unknown as { instanceId?: string }).instanceId === id ||
        // no instanceId means it's from the legacy single-instance path; include only for 'default'
        (!(ev as unknown as { instanceId?: string }).instanceId && id === 'default')
    );

    const paginated = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      data: {
        instanceId: id,
        events: paginated,
        total: filtered.length,
        activeCount: result.activeCount,
      },
      meta: meta(),
    });
  } catch (error) {
    logger.error(`[v2 GET /instances/${id}/anomalies] error:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch anomaly events.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
