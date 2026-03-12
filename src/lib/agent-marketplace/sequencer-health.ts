import { getEvents } from '@/lib/anomaly-event-store';
import { getRecentMetrics } from '@/lib/metrics-store';
import type { AnomalyEvent } from '@/types/anomaly';
import type {
  IncidentSeverity,
  ResourcePressure,
  SequencerHealthAction,
  SequencerHealthSnapshot,
  SequencerHealthStatus,
  SnapshotTrend,
} from '@/types/agent-marketplace';

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], mean: number): number {
  if (values.length === 0) {
    return 0;
  }

  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function deriveTrend(values: number[]): SnapshotTrend {
  if (values.length < 2) {
    return 'stable';
  }

  const delta = values[values.length - 1] - values[0];
  if (delta > 1) {
    return 'rising';
  }
  if (delta < -1) {
    return 'falling';
  }
  return 'stable';
}

function deriveResourcePressure(value: number, elevatedThreshold: number, criticalThreshold: number): ResourcePressure {
  if (value >= criticalThreshold) {
    return 'critical';
  }
  if (value >= elevatedThreshold) {
    return 'elevated';
  }
  return 'normal';
}

function getHighestSeverity(events: AnomalyEvent[]): IncidentSeverity {
  const ranking: IncidentSeverity[] = ['none', 'low', 'medium', 'high', 'critical'];

  return events.reduce<IncidentSeverity>((highest, event) => {
    const severity = event.deepAnalysis?.severity ?? 'medium';
    return ranking.indexOf(severity) > ranking.indexOf(highest) ? severity : highest;
  }, 'none');
}

function getLastIncidentAt(events: AnomalyEvent[]): string | null {
  const latestTimestamp = events.reduce<number | null>((latest, event) => {
    if (latest === null || event.timestamp > latest) {
      return event.timestamp;
    }
    return latest;
  }, null);

  return latestTimestamp === null ? null : new Date(latestTimestamp).toISOString();
}

function deriveStatus(score: number, highestSeverity: IncidentSeverity, stalled: boolean): SequencerHealthStatus {
  if (stalled || highestSeverity === 'critical' || score < 50) {
    return 'critical';
  }
  if (highestSeverity === 'high' || score < 80) {
    return 'degraded';
  }
  return 'healthy';
}

function deriveAction(status: SequencerHealthStatus): SequencerHealthAction {
  switch (status) {
    case 'critical':
      return 'halt';
    case 'degraded':
      return 'caution';
    default:
      return 'proceed';
  }
}

function buildReasons(input: {
  avgBlockIntervalSec: number;
  stdDevBlockIntervalSec: number;
  highestSeverity: IncidentSeverity;
  activeCount: number;
  stalled: boolean;
}): string[] {
  const reasons: string[] = [];

  if (input.stalled) {
    reasons.push('block production stalled');
  } else if (input.avgBlockIntervalSec <= 3 && input.stdDevBlockIntervalSec <= 0.5) {
    reasons.push('block interval stable');
  } else if (input.avgBlockIntervalSec > 4) {
    reasons.push('block interval elevated');
  }

  if (input.activeCount === 0) {
    reasons.push('no active critical incidents');
  } else if (input.highestSeverity === 'critical') {
    reasons.push('active critical incident');
  } else if (input.highestSeverity === 'high') {
    reasons.push('active high severity incident');
  }

  return reasons;
}

function scoreSnapshot(input: {
  avgBlockIntervalSec: number;
  stdDevBlockIntervalSec: number;
  highestSeverity: IncidentSeverity;
  cpuPressure: ResourcePressure;
  memoryPressure: ResourcePressure;
  stalled: boolean;
}): number {
  let score = 100;

  if (input.avgBlockIntervalSec > 4) {
    score -= 20;
  }
  if (input.stdDevBlockIntervalSec > 1) {
    score -= 10;
  }
  if (input.highestSeverity === 'high') {
    score -= 20;
  }
  if (input.highestSeverity === 'critical') {
    score -= 40;
  }
  if (input.cpuPressure === 'elevated') {
    score -= 10;
  }
  if (input.cpuPressure === 'critical') {
    score -= 20;
  }
  if (input.memoryPressure === 'elevated') {
    score -= 5;
  }
  if (input.memoryPressure === 'critical') {
    score -= 10;
  }
  if (input.stalled) {
    score -= 20;
  }

  return Math.max(0, Math.min(100, score));
}

export async function composeSequencerHealthSnapshot(): Promise<SequencerHealthSnapshot> {
  const metrics = await getRecentMetrics(15);
  const eventSummary = await getEvents(20, 0);
  const activeEvents = eventSummary.events.filter((event) => event.status === 'active');
  const intervalValues = metrics.map((metric) => metric.blockInterval);
  const cpuValues = metrics.map((metric) => metric.cpuUsage);
  const gasValues = metrics.map((metric) => metric.gasUsedRatio);
  const latestMetric = metrics[metrics.length - 1];
  const avgBlockIntervalSec = average(intervalValues);
  const stdDevBlockIntervalSec = standardDeviation(intervalValues, avgBlockIntervalSec);
  const highestSeverity = getHighestSeverity(activeEvents);
  const cpuPressure = deriveResourcePressure(average(cpuValues), 75, 90);
  const memoryPressure = deriveResourcePressure(average(gasValues), 0.85, 0.95);
  const stalled = metrics.length >= 2
    ? metrics.every((metric) => metric.blockHeight === metrics[0].blockHeight)
    : false;
  const healthScore = scoreSnapshot({
    avgBlockIntervalSec,
    stdDevBlockIntervalSec,
    highestSeverity,
    cpuPressure,
    memoryPressure,
    stalled,
  });
  const status = deriveStatus(healthScore, highestSeverity, stalled);

  return {
    status,
    healthScore,
    action: deriveAction(status),
    reasons: buildReasons({
      avgBlockIntervalSec,
      stdDevBlockIntervalSec,
      highestSeverity,
      activeCount: activeEvents.length,
      stalled,
    }),
    window: {
      lookbackMinutes: metrics.length,
      sampleCount: metrics.length,
    },
    blockProduction: {
      latestBlockIntervalSec: latestMetric?.blockInterval ?? 0,
      avgBlockIntervalSec: Number(avgBlockIntervalSec.toFixed(2)),
      stdDevBlockIntervalSec: Number(stdDevBlockIntervalSec.toFixed(2)),
      trend: deriveTrend(intervalValues),
      stalled,
    },
    sync: {
      lagBlocks: stalled ? 1 : 0,
      lagTrend: stalled ? 'rising' : 'stable',
      catchingUp: false,
    },
    incident: {
      activeCount: activeEvents.length,
      highestSeverity,
      lastIncidentAt: getLastIncidentAt(eventSummary.events),
    },
    resources: {
      cpuPressure,
      memoryPressure,
    },
    updatedAt: latestMetric?.timestamp ?? new Date().toISOString(),
  };
}
