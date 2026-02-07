/**
 * Anomaly Event Store
 * In-memory store for detected anomaly events
 */

import { AnomalyEvent, AnomalyResult, DeepAnalysisResult, AlertRecord, AnomalyEventStatus } from '@/types/anomaly';

// ============================================================================
// Configuration
// ============================================================================

/** Maximum number of events to store */
const MAX_EVENTS = 100;

/** Auto-resolve timeout (ms) - resolve if no new anomaly for 30 min */
const AUTO_RESOLVE_MS = 30 * 60 * 1000;

// ============================================================================
// In-Memory State
// ============================================================================

/** Event store (newest first) */
let events: AnomalyEvent[] = [];

/** Currently active event ID */
let activeEventId: string | null = null;

// ============================================================================
// Helper Functions
// ============================================================================

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
 * Clean up old events
 */
function cleanup(): void {
  // Remove oldest events when exceeding max count
  if (events.length > MAX_EVENTS) {
    events = events.slice(0, MAX_EVENTS);
  }

  // Auto-resolve stale events
  const now = Date.now();
  for (const event of events) {
    if (event.status === 'active' && now - event.timestamp > AUTO_RESOLVE_MS) {
      event.status = 'resolved';
      event.resolvedAt = now;
    }
  }

  // Update active event ID
  const activeEvent = events.find(e => e.status === 'active');
  activeEventId = activeEvent?.id || null;
}

// ============================================================================
// Main Exports
// ============================================================================

/**
 * Create a new anomaly event or append to an existing active event
 *
 * @param anomalies List of anomalies detected by Layer 1
 * @returns Created or updated event
 */
export function createOrUpdateEvent(anomalies: AnomalyResult[]): AnomalyEvent {
  cleanup();
  const now = Date.now();

  // If an active event exists, update the anomaly list
  if (activeEventId) {
    const activeEvent = events.find(e => e.id === activeEventId);
    if (activeEvent) {
      // Only add anomalies for new metrics not already present
      const existingMetrics = new Set(activeEvent.anomalies.map(a => a.metric));
      const newAnomalies = anomalies.filter(a => !existingMetrics.has(a.metric));

      if (newAnomalies.length > 0) {
        activeEvent.anomalies.push(...newAnomalies);
      }

      // Update existing anomalies (replace with latest value for the same metric)
      for (const anomaly of anomalies) {
        const existingIndex = activeEvent.anomalies.findIndex(a => a.metric === anomaly.metric);
        if (existingIndex >= 0) {
          activeEvent.anomalies[existingIndex] = anomaly;
        }
      }

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

  events.unshift(newEvent);
  activeEventId = newEvent.id;

  return newEvent;
}

/**
 * Add AI analysis result to an event
 */
export function addDeepAnalysis(eventId: string, analysis: DeepAnalysisResult): void {
  const event = events.find(e => e.id === eventId);
  if (event) {
    event.deepAnalysis = analysis;
  }
}

/**
 * Add alert record to an event
 */
export function addAlertRecord(eventId: string, alert: AlertRecord): void {
  const event = events.find(e => e.id === eventId);
  if (event) {
    event.alerts.push(alert);
  }
}

/**
 * Update event status
 */
export function updateEventStatus(eventId: string, status: AnomalyEventStatus): void {
  const event = events.find(e => e.id === eventId);
  if (event) {
    event.status = status;
    if (status === 'resolved') {
      event.resolvedAt = Date.now();
    }
    if (status !== 'active' && activeEventId === eventId) {
      activeEventId = null;
    }
  }
}

/**
 * Resolve the active event (called when no more anomalies are detected)
 */
export function resolveActiveEventIfExists(): void {
  if (activeEventId) {
    updateEventStatus(activeEventId, 'resolved');
  }
}

/**
 * Get events list (with pagination)
 */
export function getEvents(limit: number = 20, offset: number = 0): { events: AnomalyEvent[]; total: number; activeCount: number } {
  cleanup();

  const activeCount = events.filter(e => e.status === 'active').length;
  const paginatedEvents = events.slice(offset, offset + limit);

  return {
    events: paginatedEvents,
    total: events.length,
    activeCount,
  };
}

/**
 * Get a specific event by ID
 */
export function getEventById(eventId: string): AnomalyEvent | null {
  return events.find(e => e.id === eventId) || null;
}

/**
 * Get the currently active event ID
 */
export function getActiveEventId(): string | null {
  cleanup();
  return activeEventId;
}

/**
 * Clear the event store (for testing)
 */
export function clearEvents(): void {
  events = [];
  activeEventId = null;
}
