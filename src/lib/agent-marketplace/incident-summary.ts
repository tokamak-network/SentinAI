import { getEvents } from '@/lib/anomaly-event-store';
import type { AnomalyEvent } from '@/types/anomaly';
import type { IncidentSeverity, IncidentSummarySnapshot, SequencerHealthStatus } from '@/types/agent-marketplace';

function getHighestSeverity(events: AnomalyEvent[]): IncidentSeverity {
  const ranking: IncidentSeverity[] = ['none', 'low', 'medium', 'high', 'critical'];

  return events.reduce<IncidentSeverity>((highest, event) => {
    const severity = event.deepAnalysis?.severity ?? 'medium';
    return ranking.indexOf(severity) > ranking.indexOf(highest) ? severity : highest;
  }, 'none');
}

function deriveStatus(activeCount: number, highestSeverity: IncidentSeverity): SequencerHealthStatus {
  if (highestSeverity === 'critical') {
    return 'critical';
  }
  if (activeCount > 0 || highestSeverity === 'high' || highestSeverity === 'medium') {
    return 'degraded';
  }
  return 'healthy';
}

function calculateMttrMinutes(events: AnomalyEvent[]): number | null {
  const resolvedDurations = events
    .filter((event) => typeof event.resolvedAt === 'number')
    .map((event) => event.resolvedAt! - event.timestamp);

  if (resolvedDurations.length === 0) {
    return null;
  }

  const averageDurationMs = resolvedDurations.reduce((sum, duration) => sum + duration, 0) / resolvedDurations.length;
  return Math.round(averageDurationMs / 60000);
}

function getLastIncidentAt(events: AnomalyEvent[]): string | null {
  if (events.length === 0) {
    return null;
  }

  const latest = Math.max(...events.map((event) => event.timestamp));
  return new Date(latest).toISOString();
}

export async function composeIncidentSummarySnapshot(): Promise<IncidentSummarySnapshot> {
  const { events, activeCount } = await getEvents(100, 0);
  const unresolvedCount = events.filter((event) => event.status !== 'resolved').length;
  const highestSeverity = getHighestSeverity(events.filter((event) => event.status !== 'resolved'));

  return {
    status: deriveStatus(activeCount, highestSeverity),
    activeCount,
    highestSeverity,
    unresolvedCount,
    lastIncidentAt: getLastIncidentAt(events),
    rollingWindow: {
      lookbackHours: 24,
      incidentCount: events.length,
      mttrMinutes: calculateMttrMinutes(events),
    },
  };
}
