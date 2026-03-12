import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnomalyEvent } from '@/types/anomaly';

const hoisted = vi.hoisted(() => ({
  getEventsMock: vi.fn(),
}));

vi.mock('@/lib/anomaly-event-store', () => ({
  getEvents: hoisted.getEventsMock,
}));

const { composeIncidentSummarySnapshot } = await import('@/lib/agent-marketplace/incident-summary');

function createEvent(overrides?: Partial<AnomalyEvent>): AnomalyEvent {
  return {
    id: 'event-1',
    timestamp: Date.parse('2026-03-12T00:00:00.000Z'),
    anomalies: [],
    status: 'resolved',
    alerts: [],
    ...overrides,
  };
}

describe('agent-marketplace incident-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a healthy empty-state summary when there are no incidents', async () => {
    hoisted.getEventsMock.mockResolvedValue({
      events: [],
      total: 0,
      activeCount: 0,
    });

    const snapshot = await composeIncidentSummarySnapshot();

    expect(snapshot.status).toBe('healthy');
    expect(snapshot.activeCount).toBe(0);
    expect(snapshot.highestSeverity).toBe('none');
    expect(snapshot.rollingWindow.incidentCount).toBe(0);
  });

  it('returns a degraded summary for an active high severity incident', async () => {
    hoisted.getEventsMock.mockResolvedValue({
      events: [
        createEvent({
          status: 'active',
          deepAnalysis: {
            severity: 'high',
            anomalyType: 'liveness',
            correlations: [],
            predictedImpact: 'degraded throughput',
            suggestedActions: [],
            relatedComponents: [],
            timestamp: '2026-03-12T00:10:00.000Z',
          },
        }),
      ],
      total: 1,
      activeCount: 1,
    });

    const snapshot = await composeIncidentSummarySnapshot();

    expect(snapshot.status).toBe('degraded');
    expect(snapshot.activeCount).toBe(1);
    expect(snapshot.unresolvedCount).toBe(1);
    expect(snapshot.highestSeverity).toBe('high');
  });

  it('calculates a rolling incident window and mttr for resolved events', async () => {
    hoisted.getEventsMock.mockResolvedValue({
      events: [
        createEvent({
          timestamp: Date.parse('2026-03-12T00:00:00.000Z'),
          resolvedAt: Date.parse('2026-03-12T00:18:00.000Z'),
        }),
        createEvent({
          id: 'event-2',
          timestamp: Date.parse('2026-03-12T01:00:00.000Z'),
          resolvedAt: Date.parse('2026-03-12T01:12:00.000Z'),
        }),
        createEvent({
          id: 'event-3',
          timestamp: Date.parse('2026-03-12T02:00:00.000Z'),
          status: 'active',
          deepAnalysis: {
            severity: 'medium',
            anomalyType: 'performance',
            correlations: [],
            predictedImpact: 'reduced throughput',
            suggestedActions: [],
            relatedComponents: [],
            timestamp: '2026-03-12T02:00:00.000Z',
          },
        }),
      ],
      total: 3,
      activeCount: 1,
    });

    const snapshot = await composeIncidentSummarySnapshot();

    expect(snapshot.rollingWindow.lookbackHours).toBe(24);
    expect(snapshot.rollingWindow.incidentCount).toBe(3);
    expect(snapshot.rollingWindow.mttrMinutes).toBe(15);
  });
});
