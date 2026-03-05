/**
 * Public Chain SLA Status API
 * GET /api/public/status
 *
 * Returns chain health and uptime information without sensitive internal data.
 * No authentication required — safe for public consumption.
 */

import { NextResponse } from 'next/server';
import { getChainPlugin } from '@/chains';
import { getRecentMetrics } from '@/lib/metrics-store';
import { getEvents } from '@/lib/anomaly-event-store';
import { getAgentCycleCount, getLastCycleResult } from '@/lib/agent-loop';
import { isAgentV2Enabled } from '@/core/agent-orchestrator';
import { getGoalManagerConfig } from '@/lib/goal-manager';
import { getExperienceStats } from '@/lib/experience-store';
import { getAgentOrchestrator } from '@/core/agent-orchestrator';
import type { AnomalyEvent } from '@/types/anomaly';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

// Cache header: 30 second public cache (matches agent loop interval)
const CACHE_MAX_AGE = 30;

export type ChainOperationalStatus = 'operational' | 'degraded' | 'major_outage' | 'unknown';

export interface PublicIncident {
  id: string;
  detectedAt: string;
  resolvedAt?: string;
  status: 'active' | 'resolved';
  /** Safe public summary — no internal details */
  summary: string;
  affectedArea: string;
}

export interface PublicStatusResponse {
  chain: {
    name: string;
    type: string;
  };
  status: ChainOperationalStatus;
  metrics: {
    blockHeight: number;
    blockIntervalSec: number;
    lastUpdatedAt: string;
  };
  uptime: {
    /** Uptime percentage over last 24 hours (0–100) */
    h24: number;
    /** Uptime percentage over last 7 days (0–100) */
    d7: number;
  };
  incidents: {
    active: number;
    last24h: number;
    recent: PublicIncident[];
  };
  agent: {
    running: boolean;
    totalCycles: number;
    lastCycleAt?: string;
    /** V2: total domain operations from experience store */
    totalOps?: number;
    /** V2: most recent agent activity timestamp */
    lastActivityAt?: string;
  };
  generatedAt: string;
}

/**
 * Calculate uptime percentage for a given window.
 * Uptime = (window_duration - downtime_with_high_severity_anomaly) / window_duration * 100
 * Only high/critical severity anomalies count as downtime —
 * low/medium anomalies don't affect uptime (consistent with resolveStatus).
 */
function calculateUptime(events: AnomalyEvent[], windowStartMs: number, windowEndMs: number): number {
  const windowDuration = windowEndMs - windowStartMs;
  if (windowDuration <= 0) return 100;

  // Only count high/critical severity anomalies as downtime
  const overlapping = events.filter(event => {
    const severity = event.deepAnalysis?.severity;
    if (severity !== 'high' && severity !== 'critical') return false;
    const eventEnd = event.resolvedAt ?? windowEndMs;
    return event.timestamp < windowEndMs && eventEnd > windowStartMs;
  });

  if (overlapping.length === 0) return 100;

  // Merge overlapping intervals to avoid double-counting
  const intervals = overlapping.map(event => ({
    start: Math.max(event.timestamp, windowStartMs),
    end: Math.min(event.resolvedAt ?? windowEndMs, windowEndMs),
  })).sort((a, b) => a.start - b.start);

  let downtimeMs = 0;
  let mergedEnd = -1;

  for (const interval of intervals) {
    if (interval.start > mergedEnd) {
      downtimeMs += interval.end - interval.start;
      mergedEnd = interval.end;
    } else if (interval.end > mergedEnd) {
      downtimeMs += interval.end - mergedEnd;
      mergedEnd = interval.end;
    }
  }

  const uptime = Math.max(0, Math.min(100, ((windowDuration - downtimeMs) / windowDuration) * 100));
  return Math.round(uptime * 100) / 100;
}

/**
 * Determine operational status from active anomaly events.
 * Only high/critical severity anomalies affect public status —
 * low/medium anomalies are tracked internally but don't degrade the public status.
 */
function resolveStatus(
  events: AnomalyEvent[],
  hasMetrics: boolean,
): ChainOperationalStatus {
  if (!hasMetrics) return 'unknown';

  const activeEvents = events.filter(e => e.status === 'active');
  if (activeEvents.length === 0) return 'operational';

  const hasCritical = activeEvents.some(e =>
    e.deepAnalysis?.severity === 'critical'
  );
  if (hasCritical) return 'major_outage';

  const hasHigh = activeEvents.some(e =>
    e.deepAnalysis?.severity === 'high'
  );
  if (hasHigh) return 'degraded';

  // low/medium severity anomalies — network is functionally operational
  return 'operational';
}

/**
 * Build a public-safe incident summary (no internal details)
 */
function buildIncidentSummary(event: AnomalyEvent): PublicIncident {
  const affectedMetrics = event.anomalies
    .filter(a => a.isAnomaly)
    .map(a => a.metric)
    .slice(0, 3);

  const affectedArea = affectedMetrics.length > 0
    ? affectedMetrics.join(', ')
    : 'chain metrics';

  const severity = event.deepAnalysis?.severity ?? 'warning';

  const summaryMap: Record<string, string> = {
    critical: 'A critical anomaly has been detected affecting chain operations',
    high: 'An anomaly has been detected in key metrics',
    medium: 'A metric anomaly has been detected and is being monitored',
    warning: 'A minor anomaly has been detected and is being monitored',
    low: 'A low-severity anomaly has been detected',
    none: 'An anomaly was detected with minimal impact',
  };

  return {
    id: event.id.slice(0, 8),
    detectedAt: new Date(event.timestamp).toISOString(),
    resolvedAt: event.resolvedAt ? new Date(event.resolvedAt).toISOString() : undefined,
    status: event.status === 'active' ? 'active' : 'resolved',
    summary: summaryMap[severity] ?? 'An anomaly has been detected',
    affectedArea,
  };
}

export async function GET(): Promise<NextResponse<PublicStatusResponse | { error: string }>> {
  try {
    const plugin = getChainPlugin();
    const now = Date.now();
    const window24h = now - 24 * 60 * 60 * 1000;
    const window7d = now - 7 * 24 * 60 * 60 * 1000;

    // Fetch in parallel
    // Fetch enough events to cover the 7-day window accurately.
    // 500 is a safe upper bound for typical L2 deployments.
    const [recentMetrics, anomalyResult, totalCycles, lastCycle] = await Promise.all([
      getRecentMetrics(1),
      getEvents(500, 0),
      getAgentCycleCount(),
      getLastCycleResult(),
    ]);

    const latestMetric = recentMetrics[0] ?? null;
    const allEvents = anomalyResult.events;

    // Filter events for different windows
    const events24h = allEvents.filter(e => e.timestamp >= window24h);
    const events7d = allEvents.filter(e => e.timestamp >= window7d);

    // Uptime calculations
    const uptime24h = calculateUptime(events24h, window24h, now);
    const uptime7d = calculateUptime(events7d, window7d, now);

    // Operational status
    const status = resolveStatus(allEvents, latestMetric !== null);

    // Active incidents and recent incidents
    const activeCount = anomalyResult.activeCount;
    const recent24hIncidents = events24h.length;
    const recentIncidents = allEvents
      .slice(0, 5)
      .map(buildIncidentSummary);

    // Agent loop info — Agent V2 uses Goal Manager instead of cron-based agent loop
    const agentV2 = isAgentV2Enabled();
    const agentRunning = agentV2
      ? getGoalManagerConfig().enabled
      : (lastCycle !== null && (now - new Date(lastCycle.timestamp).getTime()) < 120_000);

    // V2: derive totalOps and lastActivityAt from experience store + agent statuses
    let totalOps: number | undefined;
    let lastActivityAt: string | undefined;
    if (agentV2) {
      try {
        const [expStats, statuses] = await Promise.all([
          getExperienceStats(),
          Promise.resolve(getAgentOrchestrator().getStatuses()),
        ]);
        totalOps = expStats.totalOperations;
        // Find most recent activity across all agents
        const activityTimes = statuses
          .map(s => s.lastActivityAt)
          .filter((t): t is string => t !== null)
          .sort()
          .reverse();
        lastActivityAt = activityTimes[0];
      } catch {
        // Non-critical — fall back to undefined
      }
    }

    const response: PublicStatusResponse = {
      chain: {
        name: process.env.NEXT_PUBLIC_NETWORK_NAME ?? plugin.displayName,
        type: plugin.chainType,
      },
      status,
      metrics: {
        blockHeight: latestMetric?.blockHeight ?? 0,
        blockIntervalSec: latestMetric?.blockInterval ?? plugin.expectedBlockIntervalSeconds,
        lastUpdatedAt: latestMetric?.timestamp ?? new Date(0).toISOString(),
      },
      uptime: {
        h24: uptime24h,
        d7: uptime7d,
      },
      incidents: {
        active: activeCount,
        last24h: recent24hIncidents,
        recent: recentIncidents,
      },
      agent: {
        running: agentRunning,
        totalCycles,
        lastCycleAt: lastCycle?.timestamp,
        totalOps,
        lastActivityAt,
      },
      generatedAt: new Date(now).toISOString(),
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, s-maxage=${CACHE_MAX_AGE}`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    logger.error('[Public Status API] Error:', message);
    return NextResponse.json(
      { error: 'Status information is temporarily unavailable' },
      { status: 500 },
    );
  }
}
