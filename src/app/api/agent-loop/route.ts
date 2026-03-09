/**
 * Agent Loop Status API
 * GET /api/agent-loop — Returns agent loop status, cycle history, and config
 * Query params:
 *   limit: number of cycles to return (default 50, max 500)
 *
 * When AGENT_V2=true, cycle data is synthesized from V2 orchestrator state
 * via v2-cycle-adapter. cycle-store.ts handles the V1/V2 dispatch.
 */

import { NextResponse } from 'next/server';
import { getSchedulerStatus } from '@/lib/scheduler';
import { getLastCycle, getCycleHistory, getCycleCount } from '@/lib/cycle-store';
import { isAgentV2Enabled } from '@/core/agent-orchestrator';
import { isAutoScalingEnabled, isSimulationMode, checkCooldown } from '@/lib/k8s-scaler';
import logger from '@/lib/logger';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Math.min(Math.max(1, limitParam), 500);

    const agentV2 = isAgentV2Enabled();

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
        agentTaskRunning: scheduler.agentTaskRunning,
        watchdogEnabled: scheduler.watchdogEnabled,
        watchdogTaskRunning: scheduler.watchdogTaskRunning,
        watchdogFailureStreak: scheduler.watchdogFailureStreak,
        watchdogLastError: scheduler.watchdogLastError,
        watchdogLastRecoveryStatus: scheduler.watchdogLastRecoveryStatus,
      },
      agentV2,
      lastCycle,
      recentCycles,
      totalCycles,
      config: {
        intervalSeconds: agentV2 ? 5 : 60,
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
