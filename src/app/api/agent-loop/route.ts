/**
 * Agent Loop Status API
 * GET /api/agent-loop — Returns agent loop status, cycle history, and config
 */

import { NextResponse } from 'next/server';
import { getSchedulerStatus } from '@/lib/scheduler';
import { getAgentCycleHistory, getLastCycleResult } from '@/lib/agent-loop';
import { isAutoScalingEnabled, isSimulationMode, checkCooldown } from '@/lib/k8s-scaler';

export async function GET() {
  try {
    const [scheduler, autoScaling, simulation, cooldown, lastCycle, recentCycles] = await Promise.all([
      Promise.resolve(getSchedulerStatus()),
      isAutoScalingEnabled(),
      isSimulationMode(),
      checkCooldown(),
      getLastCycleResult(),
      getAgentCycleHistory(),
    ]);

    return NextResponse.json({
      scheduler: {
        initialized: scheduler.initialized,
        agentLoopEnabled: scheduler.agentLoopEnabled,
        agentTaskRunning: scheduler.agentTaskRunning,
      },
      lastCycle,
      recentCycles,
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
