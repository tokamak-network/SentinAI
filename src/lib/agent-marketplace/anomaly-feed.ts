import { getEvents } from '@/lib/anomaly-event-store';
import type { AnomalyFeedSnapshot, AnomalyFeedStatus, IncidentSeverity } from '@/types/agent-marketplace';

function deriveFeedStatus(activeCount: number): AnomalyFeedStatus {
  if (activeCount >= 3) return 'critical';
  if (activeCount >= 1) return 'elevated';
  return 'normal';
}

export async function composeAnomalyFeedSnapshot(): Promise<AnomalyFeedSnapshot> {
  const { events, total, activeCount } = await getEvents(50, 0);

  return {
    status: deriveFeedStatus(activeCount),
    activeCount,
    totalRecent: total,
    events: events.map((event) => ({
      id: event.id,
      type: event.deepAnalysis?.anomalyType ?? 'performance',
      severity: (event.deepAnalysis?.severity ?? 'medium') as IncidentSeverity,
      status: event.status,
      description: event.anomalies[0]?.description ?? '',
      detectedAt: new Date(event.timestamp).toISOString(),
      resolvedAt: event.resolvedAt != null ? new Date(event.resolvedAt).toISOString() : null,
    })),
    updatedAt: new Date().toISOString(),
  };
}
