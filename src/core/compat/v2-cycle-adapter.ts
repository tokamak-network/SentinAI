/**
 * V2 Cycle Adapter
 * Synthesizes AgentCycleResult-compatible data from V2 orchestrator state.
 *
 * Agent V2 is event-driven (no serial "cycle"), so this adapter assembles a
 * synthetic snapshot from the latest available data sources:
 *   - Global MetricsStore (bridged from CollectorAgent every 5s)
 *   - k8s-scaler (current vCPU)
 *   - AgentOrchestrator statuses (derive current phase)
 *   - ScalingDecision calculator (reproduce score from latest metrics)
 *
 * Used by /api/agent-loop when AGENT_V2=true so the existing dashboard
 * and health endpoints work without changes.
 */

import { getRecentMetrics } from '@/lib/metrics-store';
import { getCurrentVcpu } from '@/lib/k8s-scaler';
import { makeScalingDecision } from '@/lib/scaling-decision';
import { getAgentOrchestrator } from '@/core/agent-orchestrator';
import { DEFAULT_SCALING_CONFIG } from '@/types/scaling';
import type { AgentCycleResult } from '@/types/agent-cycle';

// ============================================================
// Phase derivation
// ============================================================

type CyclePhase = AgentCycleResult['phase'];

/**
 * Derive a human-readable pipeline phase from which V2 agents are currently active.
 * "Active" = lastActivityAt within the last 20s (two collector intervals).
 */
function derivePhase(statuses: ReturnType<ReturnType<typeof getAgentOrchestrator>['getStatuses']>): CyclePhase {
  const ACTIVE_WINDOW_MS = 20_000;
  const now = Date.now();

  const isActive = (role: string) => {
    const s = statuses.find((x) => x.role === role);
    if (!s?.lastActivityAt) return false;
    return now - new Date(s.lastActivityAt).getTime() < ACTIVE_WINDOW_MS;
  };

  if (isActive('verifier')) return 'verify';
  if (isActive('executor')) return 'act';
  if (isActive('analyzer')) return 'analyze';
  if (isActive('detector')) return 'detect';
  if (isActive('collector')) return 'observe';
  return 'complete';
}

// ============================================================
// Public API
// ============================================================

/**
 * Build a synthetic cycle snapshot from the current V2 agent state.
 * Returns null if no metrics have been collected yet.
 */
export async function getV2LastCycle(): Promise<AgentCycleResult | null> {
  const [recentMetrics, currentVcpu, statuses] = await Promise.all([
    getRecentMetrics(1),
    getCurrentVcpu(),
    Promise.resolve(getAgentOrchestrator().getStatuses()),
  ]);

  const latestMetric = recentMetrics[0];

  // No data yet — V2 collector hasn't run
  if (!latestMetric) return null;

  const scalingInput = {
    cpuUsage: latestMetric.cpuUsage,
    txPoolPending: latestMetric.txPoolPending,
    gasUsedRatio: latestMetric.gasUsedRatio,
  };
  const decision = makeScalingDecision(scalingInput, DEFAULT_SCALING_CONFIG);

  return {
    timestamp: latestMetric.timestamp,
    phase: derivePhase(statuses),
    metrics: {
      l1BlockHeight: 0, // L1 block not tracked in global MetricsStore; V2 uses instance-scoped store
      l2BlockHeight: latestMetric.blockHeight,
      cpuUsage: latestMetric.cpuUsage,
      txPoolPending: latestMetric.txPoolPending,
      gasUsedRatio: latestMetric.gasUsedRatio,
    },
    detection: null, // V2 detection is event-driven; not stored as cycle artifact
    scaling: {
      score: decision.score,
      currentVcpu,
      targetVcpu: decision.targetVcpu,
      executed: false,
      reason: decision.reason,
      confidence: decision.confidence,
    },
  };
}

/**
 * V2 does not maintain a sequential cycle log.
 * Returns an empty array to satisfy callers expecting AgentCycleResult[].
 */
export async function getV2CycleHistory(_limit?: number): Promise<AgentCycleResult[]> {
  return [];
}

/**
 * V2 does not track cycle count.
 */
export async function getV2CycleCount(): Promise<number> {
  return 0;
}
