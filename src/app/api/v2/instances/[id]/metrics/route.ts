/**
 * v2 Instance Metrics Endpoint
 * GET → Recent metric data points for an instance
 *
 * Query: ?count=20  (default 20, max 60)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import { getRecentMetrics } from '@/core/instance-metrics-store';
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
        { error: '인스턴스를 찾을 수 없습니다.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const url = new URL(request.url);
    const rawCount = parseInt(url.searchParams.get('count') ?? '20', 10);
    const count = Math.min(Math.max(1, isNaN(rawCount) ? 20 : rawCount), 60);

    const dataPoints = await getRecentMetrics(id, count);

    return NextResponse.json({
      data: {
        instanceId: id,
        count: dataPoints.length,
        dataPoints,
      },
      meta: meta(),
    });
  } catch (error) {
    logger.error(`[v2 GET /instances/${id}/metrics] error:`, error);
    return NextResponse.json(
      { error: '메트릭 조회에 실패했습니다.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
