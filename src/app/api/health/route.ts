import { NextResponse } from 'next/server';
import { getLastCycleResult } from '@/lib/agent-loop';
import { getStore } from '@/lib/redis-store';
import { getSchedulerStatus } from '@/lib/scheduler';

export const dynamic = 'force-dynamic';

const DEFAULT_AGENT_HEARTBEAT_STALE_SECONDS = 120;

function parseStaleThresholdSeconds(raw: string | undefined): number {
  const parsed = Number.parseInt(raw || `${DEFAULT_AGENT_HEARTBEAT_STALE_SECONDS}`, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_AGENT_HEARTBEAT_STALE_SECONDS;
  }
  return parsed;
}

function computeLagSeconds(nowMs: number, timestamp: string | null): number | null {
  if (!timestamp) return null;
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((nowMs - parsed) / 1000));
}

export async function GET() {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const staleThresholdSec = parseStaleThresholdSeconds(process.env.AGENT_HEARTBEAT_STALE_SECONDS);

  try {
    const [heartbeatAt, lastCycle, scheduler] = await Promise.all([
      getStore().getAgentLoopHeartbeat(),
      getLastCycleResult(),
      Promise.resolve(getSchedulerStatus()),
    ]);

    const heartbeatLagSec = computeLagSeconds(nowMs, heartbeatAt);
    const stale = scheduler.agentLoopEnabled && (heartbeatLagSec === null || heartbeatLagSec > staleThresholdSec);

    return NextResponse.json({
      status: 'ok',
      timestamp: nowIso,
      agentLoop: {
        enabled: scheduler.agentLoopEnabled,
        schedulerInitialized: scheduler.initialized,
        heartbeatAt,
        heartbeatLagSec,
        staleThresholdSec,
        stale,
        lastCycleAt: lastCycle?.timestamp ?? null,
        lastCyclePhase: lastCycle?.phase ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API /health] Error:', message);

    return NextResponse.json({
      status: 'degraded',
      timestamp: nowIso,
      agentLoop: {
        enabled: false,
        schedulerInitialized: false,
        heartbeatAt: null,
        heartbeatLagSec: null,
        staleThresholdSec,
        stale: true,
        lastCycleAt: null,
        lastCyclePhase: null,
      },
      error: message,
    });
  }
}
