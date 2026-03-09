import type { AgentRole } from '@/core/agent-orchestrator';

export type FleetRole = AgentRole;

export interface FleetAgentStatus {
  role: FleetRole;
  instanceId: string;
  running: boolean;
  lastActivityAt: string | null;
}

export interface FleetPhaseTrace {
  phase: string;
  startedAt: string;
  endedAt: string;
}

export interface FleetCycle {
  timestamp: string;
  phase: string;
  phaseTrace?: FleetPhaseTrace[];
}

export interface FleetBuildInput {
  statuses: FleetAgentStatus[];
  cycles: FleetCycle[];
  now?: string | Date;
  staleAfterSec?: number;
  windowMinutes?: number;
  /** Roles that run on a fixed schedule and should be stale-checked.
   *  Event-driven roles are excluded — they only activate on events and
   *  should not show WARN just because no events have occurred.
   *  Defaults to all roles (backward-compatible). */
  scheduledRoles?: ReadonlySet<string>;
}

interface FleetRoleSummary {
  total: number;
  running: number;
  stale: number;
}

export interface FleetSnapshot {
  summary: {
    totalAgents: number;
    runningAgents: number;
    staleAgents: number;
    instanceCount: number;
  };
  kpi: {
    throughputPerMin: number;
    successRate: number;
    p95CycleMs: number;
    criticalPathPhase: string;
  };
  roles: Record<FleetRole, FleetRoleSummary>;
}

function toMs(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = typeof value === 'string' ? Date.parse(value) : value.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function makeRoleSummary(): Record<FleetRole, FleetRoleSummary> {
  return {
    collector: { total: 0, running: 0, stale: 0 },
    detector: { total: 0, running: 0, stale: 0 },
    analyzer: { total: 0, running: 0, stale: 0 },
    executor: { total: 0, running: 0, stale: 0 },
    verifier: { total: 0, running: 0, stale: 0 },
    scaling: { total: 0, running: 0, stale: 0 },
    security: { total: 0, running: 0, stale: 0 },
    reliability: { total: 0, running: 0, stale: 0 },
    rca: { total: 0, running: 0, stale: 0 },
    cost: { total: 0, running: 0, stale: 0 },
    remediation: { total: 0, running: 0, stale: 0 },
    notifier: { total: 0, running: 0, stale: 0 },
  };
}

function computeCycleDurationMs(cycle: FleetCycle): number {
  if (!cycle.phaseTrace || cycle.phaseTrace.length === 0) {
    return 0;
  }

  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;

  for (const trace of cycle.phaseTrace) {
    const start = toMs(trace.startedAt);
    const end = toMs(trace.endedAt);
    if (start === null || end === null) continue;
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  }

  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || maxEnd < minStart) {
    return 0;
  }

  return maxEnd - minStart;
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor((sorted.length - 1) * 0.95);
  return sorted[index] ?? 0;
}

export function buildAgentFleetSnapshot(input: FleetBuildInput): FleetSnapshot {
  const staleAfterSec = input.staleAfterSec ?? 120;
  const windowMinutes = input.windowMinutes ?? 60;
  const nowMs = toMs(input.now ?? new Date()) ?? Date.now();
  const staleThresholdMs = staleAfterSec * 1000;
  const windowStartMs = nowMs - windowMinutes * 60 * 1000;

  const roleSummary = makeRoleSummary();
  const instances = new Set<string>();

  let runningAgents = 0;
  let staleAgents = 0;

  for (const status of input.statuses) {
    roleSummary[status.role].total += 1;
    instances.add(status.instanceId);

    if (status.running) {
      roleSummary[status.role].running += 1;
      runningAgents += 1;

      // Only check staleness for scheduled (timer-based) roles.
      // Event-driven roles are healthy even without recent activity.
      const isScheduled = !input.scheduledRoles || input.scheduledRoles.has(status.role);
      if (isScheduled) {
        const lastActivityMs = toMs(status.lastActivityAt);
        const stale = lastActivityMs === null || nowMs - lastActivityMs > staleThresholdMs;
        if (stale) {
          roleSummary[status.role].stale += 1;
          staleAgents += 1;
        }
      }
    }
  }

  const cyclesInWindow = input.cycles.filter((cycle) => {
    const ts = toMs(cycle.timestamp);
    return ts !== null && ts >= windowStartMs && ts <= nowMs;
  });

  const terminalCycles = cyclesInWindow.filter((cycle) => cycle.phase === 'complete' || cycle.phase === 'error');
  const successCycles = terminalCycles.filter((cycle) => cycle.phase === 'complete').length;
  const successRate = terminalCycles.length > 0
    ? Number(((successCycles / terminalCycles.length) * 100).toFixed(2))
    : 0;

  const throughputPerMin = Number((cyclesInWindow.length / windowMinutes).toFixed(2));

  const cycleDurations = cyclesInWindow
    .map(computeCycleDurationMs)
    .filter((duration) => duration > 0);

  const phaseTotals = new Map<string, { totalMs: number; count: number }>();
  for (const cycle of cyclesInWindow) {
    for (const trace of cycle.phaseTrace ?? []) {
      const start = toMs(trace.startedAt);
      const end = toMs(trace.endedAt);
      if (start === null || end === null || end < start) continue;

      const prev = phaseTotals.get(trace.phase) ?? { totalMs: 0, count: 0 };
      prev.totalMs += end - start;
      prev.count += 1;
      phaseTotals.set(trace.phase, prev);
    }
  }

  let criticalPathPhase = 'unknown';
  let maxAvgDuration = -1;
  for (const [phase, stats] of phaseTotals.entries()) {
    const avg = stats.totalMs / stats.count;
    if (avg > maxAvgDuration) {
      maxAvgDuration = avg;
      criticalPathPhase = phase;
    }
  }

  return {
    summary: {
      totalAgents: input.statuses.length,
      runningAgents,
      staleAgents,
      instanceCount: instances.size,
    },
    kpi: {
      throughputPerMin,
      successRate,
      p95CycleMs: percentile95(cycleDurations),
      criticalPathPhase,
    },
    roles: roleSummary,
  };
}
