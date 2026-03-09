/**
 * v2 Instance Detail Endpoint
 * GET    → Instance detail (authToken masked)
 * PATCH  → Update instance config
 * DELETE → Delete instance + clear metrics
 *
 * Auth: PATCH/DELETE requires SENTINAI_API_KEY if set.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getInstance,
  updateInstance,
  deleteInstance,
} from '@/core/instance-registry';
import { clearMetrics } from '@/core/instance-metrics-store';
import { maskConnectionConfig } from '@/core/security';
import { getCoreRedis } from '@/core/redis';
import type { UpdateNodeInstanceDto } from '@/core/types';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

// ============================================================
// Helpers
// ============================================================

function checkWriteAuth(request: NextRequest): boolean {
  const apiKey = process.env.SENTINAI_API_KEY;
  if (!apiKey) return true;

  const headerKey =
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  return headerKey === apiKey;
}

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

type RouteContext = { params: Promise<{ id: string }> };

// ============================================================
// GET /api/v2/instances/[id]
// ============================================================

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

    const masked = {
      ...instance,
      connectionConfig: maskConnectionConfig(instance.connectionConfig),
    };

    return NextResponse.json({ data: masked, meta: meta() });
  } catch (error) {
    logger.error(`[v2 GET /instances/${id}] error:`, error);
    return NextResponse.json(
      { error: '인스턴스 조회에 실패했습니다.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// ============================================================
// PATCH /api/v2/instances/[id]
// ============================================================

export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  if (!checkWriteAuth(request)) {
    return NextResponse.json(
      { error: 'Authentication failed.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  const { id } = await context.params;
  try {
    let body: UpdateNodeInstanceDto;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body.', code: 'BAD_REQUEST' },
        { status: 400 }
      );
    }

    const updated = await updateInstance(id, body);
    if (!updated) {
      return NextResponse.json(
        { error: 'Instance not found.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const masked = {
      ...updated,
      connectionConfig: maskConnectionConfig(updated.connectionConfig),
    };

    return NextResponse.json({ data: masked, meta: meta() });
  } catch (error) {
    logger.error(`[v2 PATCH /instances/${id}] error:`, error);
    return NextResponse.json(
      { error: '인스턴스 수정에 실패했습니다.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// ============================================================
// DELETE /api/v2/instances/[id]
// ============================================================

export async function DELETE(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  if (!checkWriteAuth(request)) {
    return NextResponse.json(
      { error: 'Authentication failed.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  const { id } = await context.params;
  try {
    const deleted = await deleteInstance(id);
    if (!deleted) {
      return NextResponse.json(
        { error: 'Instance not found.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Clear metrics data
    await clearMetrics(id);

    // Clean up additional Redis keys in inst:{id}:* namespace
    const redis = getCoreRedis();
    if (redis) {
      const pattern = `inst:${id}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.info(`[v2 DELETE /instances/${id}] Cleaned ${keys.length} Redis keys`);
      }
    }

    return NextResponse.json({
      data: { instanceId: id, deleted: true },
      meta: meta(),
    });
  } catch (error) {
    logger.error(`[v2 DELETE /instances/${id}] error:`, error);
    return NextResponse.json(
      { error: '인스턴스 삭제에 실패했습니다.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
