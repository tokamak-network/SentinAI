/**
 * Agent Loop Status API
 * GET /api/agent-loop — Returns agent loop status, cycle history, and config
 * Query params:
 *   limit: number of cycles to return (default 50, max 500)
 */

import { NextResponse } from 'next/server';
import { getSchedulerStatus } from '@/lib/scheduler';
import { getAgentCycleHistory, getAgentCycleCount, getLastCycleResult } from '@/lib/agent-loop';
import { isAutoScalingEnabled, isSimulationMode, checkCooldown } from '@/lib/k8s-scaler';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Math.min(Math.max(1, limitParam), 500);

    const [scheduler, autoScaling, simulation, cooldown, lastCycle, recentCycles, totalCycles] = await Promise.all([
      Promise.resolve(getSchedulerStatus()),
      isAutoScalingEnabled(),
      isSimulationMode(),
      checkCooldown(),
      getLastCycleResult(),
      getAgentCycleHistory(limit),
      getAgentCycleCount(),
    ]);

    return NextResponse.json({
      scheduler: {
        initialized: scheduler.initialized,
        agentLoopEnabled: scheduler.agentLoopEnabled,
        agentTaskRunning: scheduler.agentTaskRunning,
      },
      lastCycle,
      recentCycles,
      totalCycles,
      config: {
        intervalSeconds: 30,
        autoScalingEnabled: autoScaling,
        simulationMode: simulation,
        cooldownRemaining: cooldown.remainingSeconds,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API] Agent loop status error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
