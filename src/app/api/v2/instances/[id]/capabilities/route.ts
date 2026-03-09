/**
 * v2 Instance Capabilities Endpoint
 * GET → Retrieve detected client + mapped capabilities from Redis (written by /validate or /onboarding/complete)
 *
 * Returns { detected: false } when no capabilities data exists yet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import { getCoreRedis } from '@/core/redis';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
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

    const redis = getCoreRedis();
    if (!redis) {
      // In-memory mode: capabilities are not persisted
      return NextResponse.json({
        data: { detected: false, reason: 'Not cached in in-memory mode.' },
        meta: meta(),
      });
    }

    const raw = await redis.get(`inst:${id}:capabilities`);
    if (!raw) {
      return NextResponse.json({
        data: { detected: false },
        meta: meta(),
      });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return NextResponse.json({
        data: { detected: false, reason: 'Stored data is corrupted.' },
        meta: meta(),
      });
    }

    return NextResponse.json({
      data: { detected: true, instanceId: id, protocolId: instance.protocolId, ...payload },
      meta: meta(),
    });
  } catch (error) {
    logger.error(`[v2 GET /instances/${id}/capabilities] error:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch capabilities.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
