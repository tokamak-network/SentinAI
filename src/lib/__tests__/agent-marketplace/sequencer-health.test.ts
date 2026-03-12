import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnomalyEvent } from '@/types/anomaly';
import type { MetricDataPoint } from '@/types/prediction';

const hoisted = vi.hoisted(() => ({
  getRecentMetricsMock: vi.fn(),
  getEventsMock: vi.fn(),
}));

vi.mock('@/lib/metrics-store', () => ({
  getRecentMetrics: hoisted.getRecentMetricsMock,
}));

vi.mock('@/lib/anomaly-event-store', () => ({
  getEvents: hoisted.getEventsMock,
}));

const { composeSequencerHealthSnapshot } = await import('@/lib/agent-marketplace/sequencer-health');

function createMetric(overrides?: Partial<MetricDataPoint>): MetricDataPoint {
  return {
    timestamp: '2026-03-12T00:00:00.000Z',
    cpuUsage: 30,
    txPoolPending: 10,
    gasUsedRatio: 0.4,
    blockHeight: 1000,
    blockInterval: 2.2,
    currentVcpu: 2,
    ...overrides,
  };
}

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

describe('agent-marketplace sequencer-health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a healthy proceed snapshot when metrics are stable and there are no active incidents', async () => {
    hoisted.getRecentMetricsMock.mockResolvedValue([
      createMetric({ timestamp: '2026-03-12T00:00:00.000Z', blockHeight: 1000, blockInterval: 2.1, cpuUsage: 28 }),
      createMetric({ timestamp: '2026-03-12T00:01:00.000Z', blockHeight: 1001, blockInterval: 2.2, cpuUsage: 29 }),
      createMetric({ timestamp: '2026-03-12T00:02:00.000Z', blockHeight: 1002, blockInterval: 2.3, cpuUsage: 31 }),
    ]);
    hoisted.getEventsMock.mockResolvedValue({
      events: [],
      total: 0,
      activeCount: 0,
    });

    const snapshot = await composeSequencerHealthSnapshot();

    expect(snapshot.status).toBe('healthy');
    expect(snapshot.action).toBe('proceed');
    expect(snapshot.healthScore).toBeGreaterThanOrEqual(80);
    expect(snapshot.reasons).toContain('no active critical incidents');
    expect(snapshot.blockProduction.trend).toBe('stable');
  });

  it('returns a degraded caution snapshot when block production slows and a high severity incident is active', async () => {
    hoisted.getRecentMetricsMock.mockResolvedValue([
      createMetric({ timestamp: '2026-03-12T00:00:00.000Z', blockHeight: 1000, blockInterval: 3.8, cpuUsage: 72 }),
      createMetric({ timestamp: '2026-03-12T00:01:00.000Z', blockHeight: 1001, blockInterval: 4.8, cpuUsage: 78 }),
      createMetric({ timestamp: '2026-03-12T00:02:00.000Z', blockHeight: 1002, blockInterval: 5.4, cpuUsage: 81 }),
    ]);
    hoisted.getEventsMock.mockResolvedValue({
      events: [
        createEvent({
          status: 'active',
          deepAnalysis: {
            severity: 'high',
            anomalyType: 'liveness',
            correlations: [],
            predictedImpact: 'delayed execution',
            suggestedActions: [],
            relatedComponents: [],
            timestamp: '2026-03-12T00:02:00.000Z',
          },
        }),
      ],
      total: 1,
      activeCount: 1,
    });

    const snapshot = await composeSequencerHealthSnapshot();

    expect(snapshot.status).toBe('degraded');
    expect(snapshot.action).toBe('caution');
    expect(snapshot.healthScore).toBeLessThan(80);
    expect(snapshot.incident.highestSeverity).toBe('high');
    expect(snapshot.reasons).toContain('active high severity incident');
  });

  it('returns a critical halt snapshot when block production is stalled and a critical incident is active', async () => {
    hoisted.getRecentMetricsMock.mockResolvedValue([
      createMetric({ timestamp: '2026-03-12T00:00:00.000Z', blockHeight: 1000, blockInterval: 12, cpuUsage: 95, gasUsedRatio: 0.97 }),
      createMetric({ timestamp: '2026-03-12T00:01:00.000Z', blockHeight: 1000, blockInterval: 14, cpuUsage: 97, gasUsedRatio: 0.98 }),
      createMetric({ timestamp: '2026-03-12T00:02:00.000Z', blockHeight: 1000, blockInterval: 16, cpuUsage: 99, gasUsedRatio: 0.99 }),
    ]);
    hoisted.getEventsMock.mockResolvedValue({
      events: [
        createEvent({
          status: 'active',
          deepAnalysis: {
            severity: 'critical',
            anomalyType: 'liveness',
            correlations: [],
            predictedImpact: 'sequencer unavailable',
            suggestedActions: [],
            relatedComponents: [],
            timestamp: '2026-03-12T00:02:00.000Z',
          },
        }),
      ],
      total: 1,
      activeCount: 1,
    });

    const snapshot = await composeSequencerHealthSnapshot();

    expect(snapshot.status).toBe('critical');
    expect(snapshot.action).toBe('halt');
    expect(snapshot.healthScore).toBeLessThan(50);
    expect(snapshot.blockProduction.stalled).toBe(true);
    expect(snapshot.resources.cpuPressure).toBe('critical');
    expect(snapshot.resources.memoryPressure).toBe('critical');
  });
});
