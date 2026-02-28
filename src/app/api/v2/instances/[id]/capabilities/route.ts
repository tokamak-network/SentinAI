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
        { error: '인스턴스를 찾을 수 없습니다.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const redis = getCoreRedis();
    if (!redis) {
      // In-memory mode: capabilities are not persisted
      return NextResponse.json({
        data: { detected: false, reason: '인메모리 모드에서는 캐시되지 않습니다.' },
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
        data: { detected: false, reason: '저장된 데이터가 손상되었습니다.' },
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
      { error: '캐퍼빌리티 조회에 실패했습니다.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
