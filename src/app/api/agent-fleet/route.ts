import { NextResponse } from 'next/server';
import { getAgentOrchestrator } from '@/core/agent-orchestrator';
import { getCycleHistory } from '@/lib/cycle-store';
import type { AgentCycleResult } from '@/types/agent-cycle';
import { buildAgentFleetSnapshot } from '@/lib/agent-fleet';
import { getExperienceStats } from '@/lib/experience-store';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get('limit') || '120', 10);
    const limit = Math.min(Math.max(10, limitParam), 500);

    const [statuses, recentCycles] = await Promise.all([
      Promise.resolve(getAgentOrchestrator().getStatuses()),
      getCycleHistory(limit),
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

    // V2 orchestrator: only collector and detector run on fixed schedule.
    // All other roles are event-driven and should not be marked stale.
    const scheduledRoles = new Set(['collector', 'detector']);
    const snapshot = buildAgentFleetSnapshot({ statuses, cycles, scheduledRoles });

    // Enrich KPIs from experience store
    try {
      const expStats = await getExperienceStats();
      if (expStats.totalOperations > 0) {
        snapshot.kpi.successRate = Number((expStats.successRate * 100).toFixed(2));
        snapshot.kpi.p95CycleMs = Math.round(expStats.avgResolutionMs);
        snapshot.kpi.criticalPathPhase = expStats.topCategories[0]?.category ?? 'unknown';
        // throughput: total ops / operating days → ops per minute
        if (expStats.operatingDays > 0) {
          const opsPerDay = expStats.totalOperations / expStats.operatingDays;
          snapshot.kpi.throughputPerMin = Number((opsPerDay / (24 * 60)).toFixed(2));
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      logger.warn(`[API] Agent fleet: experience stats fallback — ${msg}`);
    }

    const costAgent = statuses.find(s => s.role === 'cost');
    const lastCostScalingAt = costAgent?.lastCostScalingAt ?? null;

    return NextResponse.json({
      ...snapshot,
      agentV2: true,
      agents: statuses,
      lastCostScalingAt,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[API] Agent fleet status error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
