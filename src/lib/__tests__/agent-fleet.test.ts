import { describe, expect, it } from 'vitest';
import {
  buildAgentFleetSnapshot,
  type FleetAgentStatus,
  type FleetCycle,
} from '@/lib/agent-fleet';

describe('buildAgentFleetSnapshot', () => {
  it('builds fleet summary and role distribution with stale detection', () => {
    const now = '2026-03-03T12:00:00.000Z';
    const statuses: FleetAgentStatus[] = [
      { role: 'collector', instanceId: 'inst-a', running: true, lastActivityAt: '2026-03-03T11:59:30.000Z' },
      { role: 'detector', instanceId: 'inst-a', running: true, lastActivityAt: '2026-03-03T11:58:59.000Z' },
      { role: 'analyzer', instanceId: 'inst-a', running: false, lastActivityAt: null },
      { role: 'collector', instanceId: 'inst-b', running: true, lastActivityAt: '2026-03-03T11:50:00.000Z' },
      { role: 'executor', instanceId: 'inst-b', running: true, lastActivityAt: '2026-03-03T11:59:45.000Z' },
    ];

    const snapshot = buildAgentFleetSnapshot({
      statuses,
      cycles: [],
      now,
      staleAfterSec: 60,
    });

    expect(snapshot.summary.totalAgents).toBe(5);
    expect(snapshot.summary.runningAgents).toBe(4);
    expect(snapshot.summary.staleAgents).toBe(2);
    expect(snapshot.summary.instanceCount).toBe(2);
    expect(snapshot.roles.collector.total).toBe(2);
    expect(snapshot.roles.collector.stale).toBe(1);
    expect(snapshot.roles.detector.stale).toBe(1);
    expect(snapshot.roles.executor.running).toBe(1);
  });

  it('calculates throughput, success rate, p95 and critical path phase', () => {
    const now = '2026-03-03T12:00:00.000Z';
    const cycles: FleetCycle[] = [
      {
        timestamp: '2026-03-03T11:50:00.000Z',
        phase: 'complete',
        phaseTrace: [
          { phase: 'observe', startedAt: '2026-03-03T11:49:58.000Z', endedAt: '2026-03-03T11:49:59.000Z' },
          { phase: 'detect', startedAt: '2026-03-03T11:49:59.000Z', endedAt: '2026-03-03T11:50:00.000Z' },
          { phase: 'analyze', startedAt: '2026-03-03T11:50:00.000Z', endedAt: '2026-03-03T11:50:02.000Z' },
        ],
      },
      {
        timestamp: '2026-03-03T11:40:00.000Z',
        phase: 'complete',
        phaseTrace: [
          { phase: 'observe', startedAt: '2026-03-03T11:39:57.000Z', endedAt: '2026-03-03T11:39:58.000Z' },
          { phase: 'detect', startedAt: '2026-03-03T11:39:58.000Z', endedAt: '2026-03-03T11:39:59.000Z' },
          { phase: 'analyze', startedAt: '2026-03-03T11:39:59.000Z', endedAt: '2026-03-03T11:40:03.000Z' },
        ],
      },
      {
        timestamp: '2026-03-03T11:30:00.000Z',
        phase: 'error',
        phaseTrace: [
          { phase: 'observe', startedAt: '2026-03-03T11:29:59.000Z', endedAt: '2026-03-03T11:30:00.000Z' },
          { phase: 'detect', startedAt: '2026-03-03T11:30:00.000Z', endedAt: '2026-03-03T11:30:01.000Z' },
          { phase: 'analyze', startedAt: '2026-03-03T11:30:01.000Z', endedAt: '2026-03-03T11:30:04.000Z' },
        ],
      },
    ];

    const snapshot = buildAgentFleetSnapshot({
      statuses: [],
      cycles,
      now,
      windowMinutes: 60,
    });

    expect(snapshot.kpi.throughputPerMin).toBeCloseTo(0.05, 2);
    expect(snapshot.kpi.successRate).toBeCloseTo(66.67, 2);
    expect(snapshot.kpi.p95CycleMs).toBe(5000);
    expect(snapshot.kpi.criticalPathPhase).toBe('analyze');
  });

  it('returns safe defaults for empty inputs', () => {
    const snapshot = buildAgentFleetSnapshot({
      statuses: [],
      cycles: [],
      now: '2026-03-03T12:00:00.000Z',
    });

    expect(snapshot.summary.totalAgents).toBe(0);
    expect(snapshot.summary.runningAgents).toBe(0);
    expect(snapshot.summary.staleAgents).toBe(0);
    expect(snapshot.summary.instanceCount).toBe(0);
    expect(snapshot.kpi.throughputPerMin).toBe(0);
    expect(snapshot.kpi.successRate).toBe(0);
    expect(snapshot.kpi.p95CycleMs).toBe(0);
    expect(snapshot.kpi.criticalPathPhase).toBe('unknown');
    expect(snapshot.roles.collector.total).toBe(0);
    expect(snapshot.roles.verifier.total).toBe(0);
  });
});
