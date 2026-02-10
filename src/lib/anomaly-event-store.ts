/**
 * Anomaly Event Store (Redis-backed)
 * Async wrapper for detected anomaly events
 */

import { AnomalyEvent, AnomalyResult, DeepAnalysisResult, AlertRecord, AnomalyEventStatus } from '@/types/anomaly';
import { getStore } from './redis-store';

/**
 * Generate UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Create a new anomaly event or append to an existing active event
 *
 * @param anomalies List of anomalies detected by Layer 1
 * @returns Created or updated event
 */
export async function createOrUpdateEvent(anomalies: AnomalyResult[]): Promise<AnomalyEvent> {
  const store = getStore();
  await store.cleanupStaleAnomalyEvents();
  const now = Date.now();

  // Get the active event ID
  const activeEventId = await store.getActiveAnomalyEventId();

  // If an active event exists, update the anomaly list
  if (activeEventId) {
    const activeEvent = await store.getAnomalyEventById(activeEventId);
    if (activeEvent) {
      // Only add anomalies for new metrics not already present
      const existingMetrics = new Set(activeEvent.anomalies.map((a) => a.metric));
      const newAnomalies = anomalies.filter((a) => !existingMetrics.has(a.metric));

      if (newAnomalies.length > 0) {
        activeEvent.anomalies.push(...newAnomalies);
      }

      // Update existing anomalies (replace with latest value for the same metric)
      for (const anomaly of anomalies) {
        const existingIndex = activeEvent.anomalies.findIndex((a) => a.metric === anomaly.metric);
        if (existingIndex >= 0) {
          activeEvent.anomalies[existingIndex] = anomaly;
        }
      }

      await store.updateAnomalyEvent(activeEventId, { anomalies: activeEvent.anomalies });
      return activeEvent;
    }
  }

  // Create a new event
  const newEvent: AnomalyEvent = {
    id: generateUUID(),
    timestamp: now,
    anomalies,
    status: 'active',
    alerts: [],
  };

  await store.createAnomalyEvent(newEvent);
  await store.setActiveAnomalyEventId(newEvent.id);

  return newEvent;
}

/**
 * Add AI analysis result to an event
 */
export async function addDeepAnalysis(eventId: string, analysis: DeepAnalysisResult): Promise<void> {
  const store = getStore();
  await store.addDeepAnalysis(eventId, analysis);
}

/**
 * Add alert record to an event
 */
export async function addAlertRecord(eventId: string, alert: AlertRecord): Promise<void> {
  const store = getStore();
  await store.addAlertRecord(eventId, alert);
}

/**
 * Update event status
 */
export async function updateEventStatus(eventId: string, status: AnomalyEventStatus): Promise<void> {
  const store = getStore();
  await store.updateAnomalyEvent(eventId, {
    status,
    resolvedAt: status === 'resolved' ? Date.now() : undefined,
  });

  if (status !== 'active') {
    const activeId = await store.getActiveAnomalyEventId();
    if (activeId === eventId) {
      await store.setActiveAnomalyEventId(null);
    }
  }
}

/**
 * Resolve the active event (called when no more anomalies are detected)
 */
export async function resolveActiveEventIfExists(): Promise<void> {
  const store = getStore();
  const activeEventId = await store.getActiveAnomalyEventId();
  if (activeEventId) {
    await updateEventStatus(activeEventId, 'resolved');
  }
}

/**
 * Get events list (with pagination)
 */
export async function getEvents(limit: number = 20, offset: number = 0): Promise<{
  events: AnomalyEvent[];
  total: number;
  activeCount: number;
}> {
  const store = getStore();
  return store.getAnomalyEvents(limit, offset);
}

/**
 * Get a specific event by ID
 */
export async function getEventById(eventId: string): Promise<AnomalyEvent | null> {
  const store = getStore();
  return store.getAnomalyEventById(eventId);
}

/**
 * Get the currently active event ID
 */
export async function getActiveEventId(): Promise<string | null> {
  const store = getStore();
  return store.getActiveAnomalyEventId();
}

/**
 * Clear the event store (for testing)
 */
export async function clearEvents(): Promise<void> {
  const store = getStore();
  await store.clearAnomalyEvents();
}
