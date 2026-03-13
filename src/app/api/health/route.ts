import { NextResponse } from 'next/server';
import { getLastCycle } from '@/lib/cycle-store';
import { getSchedulerStatus } from '@/lib/scheduler';
import logger from '@/lib/logger';
import { getChainPlugin } from '@/chains';

export const dynamic = 'force-dynamic';

const DEFAULT_AGENT_HEARTBEAT_STALE_SECONDS = 120;

function parseStaleThresholdSeconds(raw: string | undefined): number {
  const parsed = Number.parseInt(raw || `${DEFAULT_AGENT_HEARTBEAT_STALE_SECONDS}`, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_AGENT_HEARTBEAT_STALE_SECONDS;
  }
  return parsed;
}

function getChainSnapshot(): {
  type: string;
  displayName: string;
  mode: string;
  capabilities: {
    proofMonitoring: boolean;
    settlementMonitoring: boolean;
    eoaBalanceMonitoring: boolean;
  };
} | null {
  try {
    const plugin = getChainPlugin();
    return {
      type: plugin.chainType,
      displayName: plugin.displayName,
      mode: plugin.chainMode,
      capabilities: {
        proofMonitoring: plugin.capabilities.proofMonitoring,
        settlementMonitoring: plugin.capabilities.settlementMonitoring,
        eoaBalanceMonitoring: plugin.capabilities.eoaBalanceMonitoring,
      },
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const staleThresholdSec = parseStaleThresholdSeconds(process.env.AGENT_HEARTBEAT_STALE_SECONDS);

  try {
    const chain = getChainSnapshot();
    const [lastCycle, scheduler] = await Promise.all([
      getLastCycle(),
      Promise.resolve(getSchedulerStatus()),
    ]);

    return NextResponse.json({
      status: 'ok',
      timestamp: nowIso,
      ...(chain ? { chain } : {}),
      agentLoop: {
        enabled: scheduler.agentLoopEnabled,
        agentV2: true,
        schedulerInitialized: scheduler.initialized,
        lastCycleAt: lastCycle?.timestamp ?? null,
        lastCyclePhase: lastCycle?.phase ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[API /health] Error:', message);
    const chain = getChainSnapshot();

    return NextResponse.json({
      status: 'degraded',
      timestamp: nowIso,
      ...(chain ? { chain } : {}),
      agentLoop: {
        enabled: false,
        schedulerInitialized: false,
        heartbeatAt: null,
        heartbeatLagSec: null,
        staleThresholdSec,
        stale: true,
        watchdogEnabled: false,
        watchdogFailureStreak: 0,
        watchdogLastError: null,
        watchdogLastHealthyAt: null,
        watchdogLastAlertAt: null,
        watchdogLastRecoveryAt: null,
        watchdogLastRecoveryStatus: 'idle',
        lastCycleAt: null,
        lastCyclePhase: null,
      },
      error: message,
    });
  }
}
