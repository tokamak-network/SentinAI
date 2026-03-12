import { getEvents } from '@/lib/anomaly-event-store';
import { getRecentMetrics } from '@/lib/metrics-store';
import type { BatchSubmissionStatusSnapshot, IncidentSeverity } from '@/types/agent-marketplace';

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getHighestSeverity(): IncidentSeverity {
  return 'none';
}

export async function composeBatchSubmissionStatusSnapshot(): Promise<BatchSubmissionStatusSnapshot> {
  const metrics = await getRecentMetrics(15);
  const { events } = await getEvents(20, 0);
  const activeEvents = events.filter((event) => event.status === 'active');
  const highestSeverity = activeEvents.reduce<IncidentSeverity>((highest, event) => {
    const severity = event.deepAnalysis?.severity ?? 'medium';
    const ranking: IncidentSeverity[] = ['none', 'low', 'medium', 'high', 'critical'];
    return ranking.indexOf(severity) > ranking.indexOf(highest) ? severity : highest;
  }, getHighestSeverity());
  const latestMetric = metrics[metrics.length - 1];
  const avgBlockInterval = average(metrics.map((metric) => metric.blockInterval));
  const stalled = metrics.length >= 2
    ? metrics.every((metric) => metric.blockHeight === metrics[0].blockHeight)
    : false;
  const submissionLagSec = Math.round(avgBlockInterval * 90);

  if (stalled || highestSeverity === 'critical') {
    return {
      status: 'critical',
      lastSuccessfulSubmissionAt: latestMetric?.timestamp ?? null,
      submissionLagSec,
      riskLevel: 'high',
      reasons: [
        'batch posting delayed',
        'settlement pipeline slower than baseline',
      ],
    };
  }

  if (avgBlockInterval > 4 || highestSeverity === 'high') {
    return {
      status: 'warning',
      lastSuccessfulSubmissionAt: latestMetric?.timestamp ?? null,
      submissionLagSec,
      riskLevel: 'elevated',
      reasons: [
        'batch posting delayed',
      ],
    };
  }

  return {
    status: 'healthy',
    lastSuccessfulSubmissionAt: latestMetric?.timestamp ?? null,
    submissionLagSec,
    riskLevel: 'low',
    reasons: [
      'batch posting cadence within baseline',
    ],
  };
}
