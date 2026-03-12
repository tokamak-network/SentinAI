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

const { composeBatchSubmissionStatusSnapshot } = await import('@/lib/agent-marketplace/batch-submission-status');

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

describe('agent-marketplace batch-submission-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a healthy low-risk status when recent metrics are stable', async () => {
    hoisted.getRecentMetricsMock.mockResolvedValue([
      createMetric({ timestamp: '2026-03-12T00:00:00.000Z', blockInterval: 2.1, blockHeight: 1000 }),
      createMetric({ timestamp: '2026-03-12T00:01:00.000Z', blockInterval: 2.2, blockHeight: 1001 }),
      createMetric({ timestamp: '2026-03-12T00:02:00.000Z', blockInterval: 2.2, blockHeight: 1002 }),
    ]);
    hoisted.getEventsMock.mockResolvedValue({
      events: [],
      total: 0,
      activeCount: 0,
    });

    const snapshot = await composeBatchSubmissionStatusSnapshot();

    expect(snapshot.status).toBe('healthy');
    expect(snapshot.riskLevel).toBe('low');
    expect(snapshot.reasons).toContain('batch posting cadence within baseline');
  });

  it('returns a warning elevated-risk status when submission lag is growing', async () => {
    hoisted.getRecentMetricsMock.mockResolvedValue([
      createMetric({ timestamp: '2026-03-12T00:00:00.000Z', blockInterval: 4.5, blockHeight: 1000 }),
      createMetric({ timestamp: '2026-03-12T00:01:00.000Z', blockInterval: 5.2, blockHeight: 1001 }),
      createMetric({ timestamp: '2026-03-12T00:02:00.000Z', blockInterval: 6.1, blockHeight: 1002 }),
    ]);
    hoisted.getEventsMock.mockResolvedValue({
      events: [
        createEvent({
          status: 'active',
          deepAnalysis: {
            severity: 'high',
            anomalyType: 'liveness',
            correlations: [],
            predictedImpact: 'delayed settlement',
            suggestedActions: [],
            relatedComponents: [],
            timestamp: '2026-03-12T00:02:00.000Z',
          },
        }),
      ],
      total: 1,
      activeCount: 1,
    });

    const snapshot = await composeBatchSubmissionStatusSnapshot();

    expect(snapshot.status).toBe('warning');
    expect(snapshot.riskLevel).toBe('elevated');
    expect(snapshot.submissionLagSec).toBeGreaterThanOrEqual(300);
    expect(snapshot.reasons).toContain('batch posting delayed');
  });

  it('returns a critical high-risk status when block production is stalled', async () => {
    hoisted.getRecentMetricsMock.mockResolvedValue([
      createMetric({ timestamp: '2026-03-12T00:00:00.000Z', blockInterval: 12, blockHeight: 1000 }),
      createMetric({ timestamp: '2026-03-12T00:01:00.000Z', blockInterval: 14, blockHeight: 1000 }),
      createMetric({ timestamp: '2026-03-12T00:02:00.000Z', blockInterval: 16, blockHeight: 1000 }),
    ]);
    hoisted.getEventsMock.mockResolvedValue({
      events: [
        createEvent({
          status: 'active',
          deepAnalysis: {
            severity: 'critical',
            anomalyType: 'liveness',
            correlations: [],
            predictedImpact: 'settlement halted',
            suggestedActions: [],
            relatedComponents: [],
            timestamp: '2026-03-12T00:02:00.000Z',
          },
        }),
      ],
      total: 1,
      activeCount: 1,
    });

    const snapshot = await composeBatchSubmissionStatusSnapshot();

    expect(snapshot.status).toBe('critical');
    expect(snapshot.riskLevel).toBe('high');
    expect(snapshot.reasons).toContain('settlement pipeline slower than baseline');
  });
});
