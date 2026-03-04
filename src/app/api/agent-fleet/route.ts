import { NextResponse } from 'next/server';
import { getAgentOrchestrator } from '@/core/agent-orchestrator';
import { getAgentCycleHistory, type AgentCycleResult } from '@/lib/agent-loop';
import { buildAgentFleetSnapshot } from '@/lib/agent-fleet';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get('limit') || '120', 10);
    const limit = Math.min(Math.max(10, limitParam), 500);

    const [statuses, recentCycles] = await Promise.all([
      Promise.resolve(getAgentOrchestrator().getStatuses()),
      getAgentCycleHistory(limit),
    ]);

    const cycles = recentCycles.map((cycle: AgentCycleResult) => ({
      timestamp: cycle.timestamp,
      phase: cycle.phase,
      phaseTrace: cycle.phaseTrace?.map((trace) => ({
        phase: trace.phase,
        startedAt: trace.startedAt,
        endedAt: trace.endedAt,
      })),
    }));

    const snapshot = buildAgentFleetSnapshot({ statuses, cycles });

    return NextResponse.json({
      ...snapshot,
      agents: statuses,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[API] Agent fleet status error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
