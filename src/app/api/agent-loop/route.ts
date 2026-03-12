/**
 * Agent Loop Status API
 * GET /api/agent-loop — Returns V2 agent orchestrator status, cycle history, and config
 * Query params:
 *   limit: number of cycles to return (default 50, max 500)
 */

import { NextResponse } from 'next/server';
import { getSchedulerStatus } from '@/lib/scheduler';
import { getLastCycle, getCycleHistory, getCycleCount } from '@/lib/cycle-store';
import { isAutoScalingEnabled, isSimulationMode, checkCooldown } from '@/lib/k8s-scaler';
import logger from '@/lib/logger';

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
      getLastCycle(),
      getCycleHistory(limit),
      getCycleCount(),
    ]);

    return NextResponse.json({
      scheduler: {
        initialized: scheduler.initialized,
        agentLoopEnabled: scheduler.agentLoopEnabled,
        agentV2Enabled: true,
      },
      lastCycle,
      recentCycles,
      totalCycles,
      config: {
        intervalSeconds: 5, // V2 orchestrator cycle interval
        autoScalingEnabled: autoScaling,
        simulationMode: simulation,
        cooldownRemaining: cooldown.remainingSeconds,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[API] Agent loop status error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
