/**
 * Unit tests for anomaly-event-store module
 * Tests anomaly event creation, updates, and status management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as anomalyStore from '@/lib/anomaly-event-store';
import type { AnomalyResult, AnomalyEvent } from '@/types/anomaly';

// Mock redis-store
vi.mock('@/lib/redis-store', () => {
  let events: AnomalyEvent[] = [];
  let activeEventId: string | null = null;

  return {
    getStore: () => ({
      cleanupStaleAnomalyEvents: vi.fn(),
      getActiveAnomalyEventId: async () => activeEventId,
      getAnomalyEventById: async (id: string) => events.find((e) => e.id === id) || null,
      createAnomalyEvent: async (event: AnomalyEvent) => {
        events.push(event);
      },
      updateAnomalyEvent: async (id: string, updates: Partial<AnomalyEvent>) => {
        const index = events.findIndex((e) => e.id === id);
        if (index >= 0) {
          events[index] = { ...events[index], ...updates };
        }
      },
      setActiveAnomalyEventId: async (id: string | null) => {
        activeEventId = id;
      },
      addDeepAnalysis: async (id: string, analysis) => {
        const event = events.find((e) => e.id === id);
        if (event) {
          event.deepAnalysis = analysis;
        }
      },
      addAlertRecord: async (id: string, alert) => {
        const event = events.find((e) => e.id === id);
        if (event) {
          event.alerts.push(alert);
        }
      },
      getAnomalyEvents: async (limit: number = 20, offset: number = 0) => ({
        events: events.slice(offset, offset + limit),
        total: events.length,
        activeCount: events.filter((e) => e.status === 'active').length,
      }),
      clearAnomalyEvents: async () => {
        events = [];
        activeEventId = null;
      },
    }),
  };
});

/**
 * Helper: Create mock anomaly result
 */
function createAnomaly(overrides?: Partial<AnomalyResult>): AnomalyResult {
  return {
    timestamp: Date.now(),
    metric: 'cpuUsage',
    value: 85,
    mean: 35,
    stdDev: 5,
    zScore: 10,
    direction: 'spike',
    isAnomaly: true,
    description: 'CPU spike detected',
    rule: 'z-score',
    severity: 'high',
    ...overrides,
  };
}

describe('anomaly-event-store', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await anomalyStore.clearEvents();
  });

  describe('Creating Events', () => {
    it('should create new anomaly event', async () => {
      const anomalies = [createAnomaly()];

      const event = await anomalyStore.createOrUpdateEvent(anomalies);

      expect(event).toBeDefined();
      expect(event.status).toBe('active');
      expect(event.anomalies).toHaveLength(1);
    });

    it('should generate UUID for new event', async () => {
      const event = await anomalyStore.createOrUpdateEvent([createAnomaly()]);

      expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should set timestamp on new event', async () => {
      const before = Date.now();

      const event = await anomalyStore.createOrUpdateEvent([createAnomaly()]);

      const after = Date.now();
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });

    it('should create event with multiple anomalies', async () => {
      const anomalies = [
        createAnomaly({ metric: 'cpuUsage' }),
        createAnomaly({ metric: 'txPoolPending' }),
        createAnomaly({ metric: 'blockInterval' }),
      ];

      const event = await anomalyStore.createOrUpdateEvent(anomalies);

      expect(event.anomalies).toHaveLength(3);
    });

    it('should initialize empty alerts array', async () => {
      const event = await anomalyStore.createOrUpdateEvent([createAnomaly()]);

      expect(event.alerts).toEqual([]);
    });
  });

  describe('Updating Events', () => {
    it('should update existing active event', async () => {
      const anomaly1 = createAnomaly({ metric: 'cpuUsage' });
      const event1 = await anomalyStore.createOrUpdateEvent([anomaly1]);

      const anomaly2 = createAnomaly({ metric: 'txPoolPending' });
      const event2 = await anomalyStore.createOrUpdateEvent([anomaly2]);

      // Should update same event
      expect(event2.id).toBe(event1.id);
    });

    it('should add new anomaly to existing event', async () => {
      const anomaly1 = createAnomaly({ metric: 'cpuUsage' });
      await anomalyStore.createOrUpdateEvent([anomaly1]);

      const anomaly2 = createAnomaly({ metric: 'txPoolPending' });
      const updated = await anomalyStore.createOrUpdateEvent([anomaly2]);

      expect(updated.anomalies).toHaveLength(2);
      expect(updated.anomalies.some((a) => a.metric === 'cpuUsage')).toBe(true);
      expect(updated.anomalies.some((a) => a.metric === 'txPoolPending')).toBe(true);
    });

    it('should replace anomaly with same metric', async () => {
      const anomaly1 = createAnomaly({ metric: 'cpuUsage', value: 50 });
      await anomalyStore.createOrUpdateEvent([anomaly1]);

      const anomaly2 = createAnomaly({ metric: 'cpuUsage', value: 90 });
      const updated = await anomalyStore.createOrUpdateEvent([anomaly2]);

      expect(updated.anomalies).toHaveLength(1);
      expect(updated.anomalies[0].value).toBe(90);
    });

    it('should add deep analysis to event', async () => {
      const event = await anomalyStore.createOrUpdateEvent([createAnomaly()]);
      const analysis = {
        severity: 'critical',
        anomalyType: 'performance',
        correlations: ['High CPU'],
        predictedImpact: 'Slow transactions',
        suggestedActions: ['Scale up'],
        relatedComponents: ['op-geth'],
      };

      await anomalyStore.addDeepAnalysis(event.id, analysis);

      const retrieved = await anomalyStore.getEventById(event.id);
      expect(retrieved?.deepAnalysis).toEqual(analysis);
    });

    it('should add alert record to event', async () => {
      const event = await anomalyStore.createOrUpdateEvent([createAnomaly()]);
      const alert = {
        channel: 'slack',
        sentAt: new Date().toISOString(),
        status: 'sent',
      };

      await anomalyStore.addAlertRecord(event.id, alert);

      const retrieved = await anomalyStore.getEventById(event.id);
      expect(retrieved?.alerts).toHaveLength(1);
      expect(retrieved?.alerts[0].channel).toBe('slack');
    });
  });

  describe('Status Management', () => {
    it('should update event status to resolved', async () => {
      const event = await anomalyStore.createOrUpdateEvent([createAnomaly()]);

      await anomalyStore.updateEventStatus(event.id, 'resolved');

      const retrieved = await anomalyStore.getEventById(event.id);
      expect(retrieved?.status).toBe('resolved');
    });

    it('should set resolvedAt timestamp when resolving', async () => {
      const event = await anomalyStore.createOrUpdateEvent([createAnomaly()]);

      await anomalyStore.updateEventStatus(event.id, 'resolved');

      const retrieved = await anomalyStore.getEventById(event.id);
      expect(retrieved?.resolvedAt).toBeTruthy();
      expect(typeof retrieved?.resolvedAt).toBe('number');
    });

    it('should clear active event ID when resolving', async () => {
      const event = await anomalyStore.createOrUpdateEvent([createAnomaly()]);

      await anomalyStore.updateEventStatus(event.id, 'resolved');

      const activeId = await anomalyStore.getActiveEventId();
      expect(activeId).toBeNull();
    });

    it('should resolve active event if exists', async () => {
      const event = await anomalyStore.createOrUpdateEvent([createAnomaly()]);
      expect(await anomalyStore.getActiveEventId()).toBe(event.id);

      await anomalyStore.resolveActiveEventIfExists();

      const retrieved = await anomalyStore.getEventById(event.id);
      expect(retrieved?.status).toBe('resolved');
    });

    it('should handle no active event gracefully', async () => {
      // Should not throw
      await expect(anomalyStore.resolveActiveEventIfExists()).resolves.not.toThrow();
    });
  });

  describe('Retrieving Events', () => {
    it('should get events with pagination', async () => {
      // Create events by resolving after each one
      for (let i = 0; i < 30; i++) {
        const event = await anomalyStore.createOrUpdateEvent([
          createAnomaly({ metric: `metric${i % 5}` }),
        ]);
        // Resolve to create new events on next iteration
        await anomalyStore.updateEventStatus(event.id, 'resolved');
      }

      const { events } = await anomalyStore.getEvents(10, 0);

      expect(events.length).toBeGreaterThan(0);
    });

    it('should get active count in events response', async () => {
      await anomalyStore.createOrUpdateEvent([createAnomaly()]);
      await anomalyStore.createOrUpdateEvent([createAnomaly({ metric: 'txPoolPending' })]);

      const { activeCount } = await anomalyStore.getEvents(10, 0);

      expect(activeCount).toBeGreaterThan(0);
    });

    it('should get specific event by ID', async () => {
      const event = await anomalyStore.createOrUpdateEvent([createAnomaly()]);

      const retrieved = await anomalyStore.getEventById(event.id);

      expect(retrieved?.id).toBe(event.id);
      expect(retrieved?.status).toBe('active');
    });

    it('should return null for non-existent event ID', async () => {
      const retrieved = await anomalyStore.getEventById('non-existent-id');

      expect(retrieved).toBeNull();
    });

    it('should get active event ID', async () => {
      const event = await anomalyStore.createOrUpdateEvent([createAnomaly()]);

      const activeId = await anomalyStore.getActiveEventId();

      expect(activeId).toBe(event.id);
    });

    it('should return null for active event ID when none active', async () => {
      const activeId = await anomalyStore.getActiveEventId();

      expect(activeId).toBeNull();
    });
  });

  describe('Integration: Full Event Lifecycle', () => {
    it('should handle complete event lifecycle', async () => {
      // Create event with anomaly
      const anomalies = [
        createAnomaly({ metric: 'cpuUsage' }),
        createAnomaly({ metric: 'txPoolPending' }),
      ];
      const event = await anomalyStore.createOrUpdateEvent(anomalies);

      // Add analysis
      const analysis = {
        severity: 'high',
        anomalyType: 'performance',
        correlations: ['High CPU', 'TxPool increase'],
        predictedImpact: 'Slow processing',
        suggestedActions: ['Scale up'],
        relatedComponents: ['op-geth'],
      };
      await anomalyStore.addDeepAnalysis(event.id, analysis);

      // Add alerts
      await anomalyStore.addAlertRecord(event.id, {
        channel: 'slack',
        sentAt: new Date().toISOString(),
        status: 'sent',
      });

      // Resolve event
      await anomalyStore.updateEventStatus(event.id, 'resolved');

      // Verify final state
      const final = await anomalyStore.getEventById(event.id);

      expect(final?.anomalies).toHaveLength(2);
      expect(final?.deepAnalysis?.severity).toBe('high');
      expect(final?.alerts).toHaveLength(1);
      expect(final?.status).toBe('resolved');
    });

    it('should handle multiple events with different statuses', async () => {
      const event1 = await anomalyStore.createOrUpdateEvent([
        createAnomaly({ metric: 'cpuUsage' }),
      ]);
      const event2 = await anomalyStore.createOrUpdateEvent([
        createAnomaly({ metric: 'txPoolPending' }),
      ]);

      await anomalyStore.updateEventStatus(event1.id, 'resolved');

      const { activeCount, total } = await anomalyStore.getEvents(10, 0);

      expect(total).toBe(1); // Only one event after update
      expect(activeCount).toBeLessThanOrEqual(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty anomalies array', async () => {
      const event = await anomalyStore.createOrUpdateEvent([]);

      expect(event.anomalies).toHaveLength(0);
    });

    it('should handle many anomalies', async () => {
      const anomalies = Array(50)
        .fill(null)
        .map((_, i) => createAnomaly({ metric: `metric${i}` }));

      const event = await anomalyStore.createOrUpdateEvent(anomalies);

      expect(event.anomalies.length).toBeGreaterThan(0);
    });

    it('should clear all events', async () => {
      for (let i = 0; i < 5; i++) {
        await anomalyStore.createOrUpdateEvent([createAnomaly()]);
      }

      await anomalyStore.clearEvents();

      const { events } = await anomalyStore.getEvents(10, 0);
      expect(events).toHaveLength(0);
    });

    it('should handle concurrent event creation', async () => {
      const promises = Array(5)
        .fill(null)
        .map(() =>
          anomalyStore.createOrUpdateEvent([
            createAnomaly({ metric: `metric${Math.random()}` }),
          ])
        );

      const events = await Promise.all(promises);

      expect(events).toHaveLength(5);
    });
  });
});
