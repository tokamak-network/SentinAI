/**
 * v2 Instance Agent Status Endpoint
 * GET → Agent runtime state for this instance
 *
 * Returns real agent status from AgentOrchestrator.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import { getAgentOrchestrator } from '@/core/agent-orchestrator';
import type { AgentStatus } from '@/core/agent-orchestrator';
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

    const orchestrator = getAgentOrchestrator();
    const statuses = orchestrator.getInstanceStatuses(id);

    const agentRunning = statuses.length > 0 && statuses.some(s => s.running);
    const lastCycleAt = statuses.reduce<string | null>((latest, s) => {
      if (!s.lastActivityAt) return latest;
      if (!latest) return s.lastActivityAt;
      return s.lastActivityAt > latest ? s.lastActivityAt : latest;
    }, null);

    return NextResponse.json({
      data: {
        instanceId: id,
        agentRunning,
        lastCycleAt,
        cycleCount: 0,
        agents: statuses.map(s => ({
          role: s.role,
          running: s.running,
          lastActivityAt: s.lastActivityAt,
        })),
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
