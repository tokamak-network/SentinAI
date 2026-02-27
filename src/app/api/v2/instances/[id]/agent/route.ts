/**
 * v2 Instance Agent Status Endpoint
 * GET → Agent runtime state for this instance
 *
 * Returns stub data until AgentOrchestrator is wired per-instance.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
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

    // TODO: Wire to AgentOrchestrator per-instance state when implemented
    return NextResponse.json({
      data: {
        instanceId: id,
        agentRunning: false,
        lastCycleAt: null,
        cycleCount: 0,
      },
      meta: meta(),
    });
  } catch (error) {
    logger.error(`[v2 GET /instances/${id}/agent] error:`, error);
    return NextResponse.json(
      { error: '에이전트 상태 조회에 실패했습니다.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
