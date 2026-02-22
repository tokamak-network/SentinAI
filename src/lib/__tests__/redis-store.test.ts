/**
 * Unit tests for redis-store module (InMemoryStateStore)
 * Tests state store interface for metrics, scaling, and P1-P3 features
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryStateStore } from '@/lib/redis-store';
import type {
  MetricDataPoint,
  ScalingHistoryEntry,
  PredictionResult,
} from '@/types/prediction';
import type { AnomalyEvent, AlertConfig, UsageDataPoint, AccumulatorState, PredictionRecord } from '@/types/daily-report';
import type { McpApprovalTicket } from '@/types/mcp';
import type { AgentMemoryEntry, DecisionTrace } from '@/types/agent-memory';

/**
 * Helper: Create mock metric data point
 */
function createMetricPoint(overrides?: Partial<MetricDataPoint>): MetricDataPoint {
  return {
    timestamp: Date.now(),
    cpuUsage: 50,
    blockHeight: 10000,
    blockInterval: 2.5,
    txPoolPending: 200,
    gasUsedRatio: 0.6,
    currentVcpu: 2,
    ...overrides,
  };
}

/**
 * Helper: Create mock scaling history entry
 */
function createScalingEntry(overrides?: Partial<ScalingHistoryEntry>): ScalingHistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    reason: 'CPU spike',
    fromVcpu: 2,
    toVcpu: 4,
    simulatedMode: false,
    ...overrides,
  };
}

/**
 * Helper: Create mock anomaly event
 */
function createAnomalyEvent(overrides?: Partial<AnomalyEvent>): AnomalyEvent {
  return {
    id: `anomaly-${Date.now()}`,
    timestamp: Date.now(),
    metric: 'cpuUsage',
    severity: 'high',
    status: 'active',
    description: 'CPU spike detected',
    ...overrides,
  };
}

/**
 * Helper: Create mock usage data point
 */
function createUsagePoint(overrides?: Partial<UsageDataPoint>): UsageDataPoint {
  return {
    timestamp: Date.now(),
    vcpu: 2,
    cpuUtilization: 50,
    ...overrides,
  };
}

/**
 * Helper: Create mock accumulator state
 */
function createAccumulatorState(overrides?: Partial<AccumulatorState>): AccumulatorState {
  return {
    currentDate: '2026-02-10',
    data: {
      date: '2026-02-10',
      startTime: new Date().toISOString(),
      lastSnapshotTime: new Date().toISOString(),
      snapshots: [],
      hourlySummaries: Array(24).fill({
        hour: 0,
        snapshotCount: 0,
        avgCpu: 0,
        maxCpu: 0,
        avgTxPool: 0,
        maxTxPool: 0,
        avgGasRatio: 0,
        avgBlockInterval: 0,
        blocksProduced: 0,
        vcpuChanges: [],
      }),
      logAnalysisResults: [],
      scalingEvents: [],
      metadata: { dataCompleteness: 0, dataGaps: [] },
    },
    lastSnapshotTimestamp: Date.now(),
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('redis-store (InMemoryStateStore)', () => {
  let store: InMemoryStateStore;

  beforeEach(() => {
    store = new InMemoryStateStore();
    vi.clearAllMocks();
  });

  describe('Metrics Buffer', () => {
    it('should push and retrieve metrics', async () => {
      const metric = createMetricPoint();

      await store.pushMetric(metric);

      const retrieved = await store.getRecentMetrics();

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].cpuUsage).toBe(50);
    });

    it('should retrieve specific count of metrics', async () => {
      for (let i = 0; i < 5; i++) {
        await store.pushMetric(createMetricPoint({ cpuUsage: 30 + i * 10 }));
      }

      const recent = await store.getRecentMetrics(3);

      expect(recent).toHaveLength(3);
    });

    it('should respect max buffer size (60)', async () => {
      for (let i = 0; i < 80; i++) {
        await store.pushMetric(createMetricPoint({ cpuUsage: i }));
      }

      const count = await store.getMetricsCount();

      expect(count).toBe(60);
    });

    it('should clear metrics buffer', async () => {
      await store.pushMetric(createMetricPoint());
      let count = await store.getMetricsCount();
      expect(count).toBe(1);

      await store.clearMetrics();
      count = await store.getMetricsCount();

      expect(count).toBe(0);
    });

    it('should return correct metrics count', async () => {
      for (let i = 0; i < 5; i++) {
        await store.pushMetric(createMetricPoint());
      }

      const count = await store.getMetricsCount();

      expect(count).toBe(5);
    });
  });

  describe('Scaling State', () => {
    it('should get default scaling state', async () => {
      const state = await store.getScalingState();

      expect(state.currentVcpu).toBe(1);
      expect(state.currentMemoryGiB).toBe(2);
      expect(state.autoScalingEnabled).toBe(true);
    });

    it('should update scaling state', async () => {
      await store.updateScalingState({ currentVcpu: 4 });

      const state = await store.getScalingState();

      expect(state.currentVcpu).toBe(4);
    });

    it('should handle partial updates', async () => {
      const original = await store.getScalingState();

      await store.updateScalingState({
        currentVcpu: 2,
        cooldownRemaining: 300,
      });

      const updated = await store.getScalingState();

      expect(updated.currentVcpu).toBe(2);
      expect(updated.cooldownRemaining).toBe(300);
      expect(updated.autoScalingEnabled).toBe(original.autoScalingEnabled);
    });

    it('should disable auto-scaling', async () => {
      await store.updateScalingState({ autoScalingEnabled: false });

      const state = await store.getScalingState();

      expect(state.autoScalingEnabled).toBe(false);
    });
  });

  describe('Scaling History', () => {
    it('should add scaling history entry', async () => {
      const entry = createScalingEntry();

      await store.addScalingHistory(entry);

      const history = await store.getScalingHistory();

      expect(history).toHaveLength(1);
      expect(history[0].reason).toBe('CPU spike');
    });

    it('should retrieve limited scaling history', async () => {
      for (let i = 0; i < 15; i++) {
        await store.addScalingHistory(
          createScalingEntry({ fromVcpu: 1, toVcpu: 2 + (i % 3) })
        );
      }

      const history = await store.getScalingHistory(5);

      expect(history).toHaveLength(5);
    });

    it('should respect max history size (50)', async () => {
      for (let i = 0; i < 70; i++) {
        await store.addScalingHistory(createScalingEntry());
      }

      const history = await store.getScalingHistory(100);

      expect(history.length).toBeLessThanOrEqual(50);
    });

    it('should return newest entries first', async () => {
      for (let i = 0; i < 3; i++) {
        await store.addScalingHistory(
          createScalingEntry({ fromVcpu: i, toVcpu: i + 1 })
        );
      }

      const history = await store.getScalingHistory();

      // Newest first: should be 2→3, 1→2, 0→1
      expect(history[0].fromVcpu).toBe(2);
      expect(history[1].fromVcpu).toBe(1);
      expect(history[2].fromVcpu).toBe(0);
    });
  });

  describe('Simulation Config', () => {
    it('should get default simulation config', async () => {
      const config = await store.getSimulationConfig();

      expect(config.enabled).toBeDefined();
      expect(typeof config.mockCurrentVcpu).toBe('number');
    });

    it('should set simulation config', async () => {
      await store.setSimulationConfig({ enabled: false, mockCurrentVcpu: 4 });

      const config = await store.getSimulationConfig();

      expect(config.enabled).toBe(false);
      expect(config.mockCurrentVcpu).toBe(4);
    });

    it('should handle partial simulation config updates', async () => {
      await store.setSimulationConfig({ mockCurrentVcpu: 8 });

      const updated = await store.getSimulationConfig();

      expect(updated.mockCurrentVcpu).toBe(8);
      expect(typeof updated.enabled).toBe('boolean');
    });
  });

  describe('Zero-Downtime Scaling', () => {
    it('should get zero-downtime enabled flag', async () => {
      const enabled = await store.getZeroDowntimeEnabled();

      expect(typeof enabled).toBe('boolean');
    });

    it('should set zero-downtime enabled', async () => {
      await store.setZeroDowntimeEnabled(true);

      const enabled = await store.getZeroDowntimeEnabled();

      expect(enabled).toBe(true);
    });

    it('should toggle zero-downtime flag', async () => {
      const enabled = await store.getZeroDowntimeEnabled();
      await store.setZeroDowntimeEnabled(!enabled);

      const toggled = await store.getZeroDowntimeEnabled();

      expect(toggled).toBe(!enabled);
    });
  });

  describe('Prediction Cache', () => {
    it('should store and retrieve last prediction', async () => {
      const prediction: PredictionResult = {
        predictedVcpu: 4,
        confidence: 0.85,
        reason: 'CPU rising',
      };

      await store.setLastPrediction(prediction);

      const retrieved = await store.getLastPrediction();

      expect(retrieved).toEqual(prediction);
    });

    it('should return null when no prediction', async () => {
      const prediction = await store.getLastPrediction();

      expect(prediction).toBeNull();
    });

    it('should set and get prediction time', async () => {
      const now = Date.now();

      await store.setLastPredictionTime(now);

      const time = await store.getLastPredictionTime();

      expect(time).toBe(now);
    });

    it('should reset prediction state', async () => {
      const prediction: PredictionResult = {
        predictedVcpu: 2,
        confidence: 0.7,
        reason: 'CPU stable',
      };

      await store.setLastPrediction(prediction);
      await store.setLastPredictionTime(Date.now());

      await store.resetPredictionState();

      const retrievedPrediction = await store.getLastPrediction();
      const retrievedTime = await store.getLastPredictionTime();

      expect(retrievedPrediction).toBeNull();
      expect(retrievedTime).toBe(0);
    });
  });

  describe('Block Tracking', () => {
    it('should set and get last block', async () => {
      await store.setLastBlock('12345', '2026-02-10T10:00:00Z');

      const block = await store.getLastBlock();

      expect(block.height).toBe('12345');
      expect(block.time).toBe('2026-02-10T10:00:00Z');
    });

    it('should return nulls for unset block', async () => {
      const block = await store.getLastBlock();

      expect(block.height).toBeNull();
      expect(block.time).toBeNull();
    });

    it('should update block information', async () => {
      await store.setLastBlock('10000', '2026-02-10T09:00:00Z');
      await store.setLastBlock('10001', '2026-02-10T09:10:00Z');

      const block = await store.getLastBlock();

      expect(block.height).toBe('10001');
      expect(block.time).toBe('2026-02-10T09:10:00Z');
    });
  });

  describe('Anomaly Events (P1)', () => {
    it('should create and retrieve anomaly event', async () => {
      const event = createAnomalyEvent();

      await store.createAnomalyEvent(event);

      const retrieved = await store.getAnomalyEventById(event.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.severity).toBe('high');
    });

    it('should get anomaly events with pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await store.createAnomalyEvent(
          createAnomalyEvent({ severity: i % 2 === 0 ? 'high' : 'critical' })
        );
      }

      const { events, total } = await store.getAnomalyEvents(3, 0);

      expect(events).toHaveLength(3);
      expect(total).toBe(5);
    });

    it('should get active anomaly event count', async () => {
      await store.createAnomalyEvent(
        createAnomalyEvent({ status: 'active' })
      );
      await store.createAnomalyEvent(
        createAnomalyEvent({ status: 'active' })
      );
      await store.createAnomalyEvent(
        createAnomalyEvent({ status: 'resolved' })
      );

      const { events, activeCount } = await store.getAnomalyEvents(10, 0);

      expect(activeCount).toBe(2);
      expect(events.length).toBe(3);
    });

    it('should update anomaly event status', async () => {
      const event = createAnomalyEvent({ status: 'active' });

      await store.createAnomalyEvent(event);
      await store.updateAnomalyEvent(event.id, { status: 'resolved' });

      const updated = await store.getAnomalyEventById(event.id);

      expect(updated!.status).toBe('resolved');
    });

    it('should clear anomaly events', async () => {
      for (let i = 0; i < 3; i++) {
        await store.createAnomalyEvent(createAnomalyEvent());
      }

      await store.clearAnomalyEvents();

      const { total } = await store.getAnomalyEvents(10, 0);

      expect(total).toBe(0);
    });

    it('should manage active anomaly event ID', async () => {
      const event = createAnomalyEvent({ status: 'active' });

      // Create the event first (which sets active ID)
      await store.createAnomalyEvent(event);

      const activeId = await store.getActiveAnomalyEventId();

      expect(activeId).toBe(event.id);
    });

    it('should clear active anomaly event ID', async () => {
      const event = createAnomalyEvent();

      await store.setActiveAnomalyEventId(event.id);
      await store.setActiveAnomalyEventId(null);

      const activeId = await store.getActiveAnomalyEventId();

      expect(activeId).toBeNull();
    });
  });

  describe('Usage Tracker (P1)', () => {
    it('should push and retrieve usage data', async () => {
      const point = createUsagePoint();

      await store.pushUsageData(point);

      const data = await store.getUsageData(7);

      expect(data).toHaveLength(1);
      expect(data[0].vcpu).toBe(2);
    });

    it('should retrieve usage data for specific days', async () => {
      const now = Date.now();

      for (let i = 0; i < 10; i++) {
        await store.pushUsageData(
          createUsagePoint({ timestamp: now - i * 60 * 60 * 1000 })
        );
      }

      const data = await store.getUsageData(1);

      // Should only include data from last 24 hours
      expect(data.length).toBeGreaterThan(0);
      expect(data.length).toBeLessThanOrEqual(10);
    });

    it('should get usage data count', async () => {
      for (let i = 0; i < 5; i++) {
        await store.pushUsageData(createUsagePoint());
      }

      const count = await store.getUsageDataCount();

      expect(count).toBe(5);
    });

    it('should clear usage data', async () => {
      for (let i = 0; i < 3; i++) {
        await store.pushUsageData(createUsagePoint());
      }

      await store.clearUsageData();

      const count = await store.getUsageDataCount();

      expect(count).toBe(0);
    });
  });

  describe('Daily Accumulator (P2)', () => {
    it('should set and get daily accumulator state', async () => {
      const state = createAccumulatorState();

      await store.setDailyAccumulatorState('2026-02-10', state);

      const retrieved = await store.getDailyAccumulatorState('2026-02-10');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.currentDate).toBe('2026-02-10');
    });

    it('should return null for non-existent date', async () => {
      const state = await store.getDailyAccumulatorState('2026-01-01');

      expect(state).toBeNull();
    });

    it('should delete daily accumulator state', async () => {
      const state = createAccumulatorState();

      await store.setDailyAccumulatorState('2026-02-10', state);
      await store.deleteDailyAccumulatorState('2026-02-10');

      const retrieved = await store.getDailyAccumulatorState('2026-02-10');

      expect(retrieved).toBeNull();
    });

    it('should update daily accumulator data', async () => {
      const state = createAccumulatorState();

      await store.setDailyAccumulatorState('2026-02-10', state);
      await store.updateDailyAccumulatorData('2026-02-10', {
        metadata: { dataCompleteness: 0.8, dataGaps: [] },
      });

      const updated = await store.getDailyAccumulatorState('2026-02-10');

      expect(updated!.data.metadata.dataCompleteness).toBe(0.8);
    });
  });

  describe('Alert Config (P2)', () => {
    it('should get default alert config', async () => {
      const config = await store.getAlertConfig();

      expect(config.enabled).toBe(true);
      expect(config.thresholds).toBeDefined();
    });

    it('should set alert config', async () => {
      const config: AlertConfig = {
        enabled: false,
        channels: ['slack'],
        severityFilter: 'high',
        cooldownMinutes: { low: 60, medium: 30, high: 10, critical: 0 },
      };

      await store.setAlertConfig(config);

      const retrieved = await store.getAlertConfig();

      expect(retrieved.enabled).toBe(false);
      expect(retrieved.severityFilter).toBe('high');
    });

    it('should get alert history', async () => {
      const history = await store.getAlertHistory();

      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('Prediction Tracker (P3)', () => {
    it('should add and retrieve prediction records', async () => {
      const record: PredictionRecord = {
        id: 'pred-1',
        timestamp: Date.now(),
        predictedVcpu: 4,
        actualVcpu: 2,
        confidence: 0.85,
        accurate: false,
      };

      await store.addPredictionRecord(record);

      const records = await store.getPredictionRecords(10);

      expect(records).toHaveLength(1);
        expect(records[0].predictedVcpu).toBe(4);
    });

    it('should respect prediction records limit (100)', async () => {
      for (let i = 0; i < 120; i++) {
        await store.addPredictionRecord({
          id: `pred-${i}`,
          timestamp: Date.now(),
          predictedVcpu: 2,
          actualVcpu: 2,
          confidence: 0.8,
          accurate: true,
        });
      }

      const records = await store.getPredictionRecords(200);

      expect(records.length).toBeLessThanOrEqual(100);
    });

    it('should update prediction record', async () => {
      const record: PredictionRecord = {
        id: 'pred-1',
        timestamp: Date.now(),
        predictedVcpu: 4,
        actualVcpu: 0,
        confidence: 0.85,
        accurate: false,
      };

      await store.addPredictionRecord(record);
      await store.updatePredictionRecord('pred-1', { actualVcpu: 4, accurate: true });

      const records = await store.getPredictionRecords(10);

      expect(records[0].actualVcpu).toBe(4);
      expect(records[0].accurate).toBe(true);
    });

    it('should clear prediction records', async () => {
      for (let i = 0; i < 5; i++) {
        await store.addPredictionRecord({
          id: `pred-${i}`,
          timestamp: Date.now(),
          predictedVcpu: 2,
          actualVcpu: 2,
          confidence: 0.8,
          accurate: true,
        });
      }

      await store.clearPredictionRecords();

      const records = await store.getPredictionRecords(10);

      expect(records).toHaveLength(0);
    });
  });

  describe('MCP Approval Tickets', () => {
    it('should create and retrieve MCP approval ticket', async () => {
      const now = Date.now();
      const ticket: McpApprovalTicket = {
        id: 'ticket-1',
        toolName: 'scale_component',
        paramsHash: 'hash-1',
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
        approvedBy: 'tester',
      };

      await store.createMcpApprovalTicket(ticket);

      const retrieved = await store.getMcpApprovalTicket('ticket-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.toolName).toBe('scale_component');
      expect(retrieved?.approvedBy).toBe('tester');
    });

    it('should consume MCP approval ticket once', async () => {
      const now = Date.now();
      const ticket: McpApprovalTicket = {
        id: 'ticket-2',
        toolName: 'restart_component',
        paramsHash: 'hash-2',
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
      };

      await store.createMcpApprovalTicket(ticket);

      const first = await store.consumeMcpApprovalTicket('ticket-2');
      const second = await store.consumeMcpApprovalTicket('ticket-2');

      expect(first).not.toBeNull();
      expect(first?.toolName).toBe('restart_component');
      expect(second).toBeNull();
    });
  });

  describe('Agent Memory and Decision Trace', () => {
    it('should add and query agent memory', async () => {
      const entry: AgentMemoryEntry = {
        id: 'memory-1',
        timestamp: new Date().toISOString(),
        category: 'analysis',
        chainType: 'thanos',
        summary: 'CPU spike observed',
        component: 'op-geth',
        severity: 'high',
      };

      await store.addAgentMemory(entry);

      const list = await store.queryAgentMemory({ limit: 10, component: 'op-geth' });
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('memory-1');
    });

    it('should add and retrieve decision trace', async () => {
      const trace: DecisionTrace = {
        decisionId: 'decision-1',
        timestamp: new Date().toISOString(),
        chainType: 'thanos',
        inputs: { anomalyCount: 1, metrics: null, scalingScore: 82 },
        reasoningSummary: 'Scale up due to txpool growth',
        evidence: [{ type: 'metric', key: 'txPoolPending', value: '1200' }],
        chosenAction: 'scale_to_4',
        alternatives: ['keep_2'],
        phaseTrace: [],
        verification: {
          expected: '4 vCPU',
          observed: '4 vCPU',
          passed: true,
        },
      };

      await store.addDecisionTrace(trace);

      const single = await store.getDecisionTrace('decision-1');
      const list = await store.listDecisionTraces({ limit: 5 });

      expect(single).not.toBeNull();
      expect(single?.decisionId).toBe('decision-1');
      expect(list).toHaveLength(1);
      expect(list[0].chosenAction).toBe('scale_to_4');
    });
  });

  describe('Integration: Full Store Lifecycle', () => {
    it('should handle complete workflow with multiple operations', async () => {
      // Push metrics
      await store.pushMetric(createMetricPoint());

      // Update scaling state
      await store.updateScalingState({ currentVcpu: 4 });

      // Add scaling history
      await store.addScalingHistory(createScalingEntry());

      // Create anomaly event
      const event = createAnomalyEvent();
      await store.createAnomalyEvent(event);

      // Record usage data
      await store.pushUsageData(createUsagePoint());

      // Set daily accumulator
      await store.setDailyAccumulatorState('2026-02-10', createAccumulatorState());

      // Set alert config
      const config: AlertConfig = {
        enabled: true,
        channels: ['slack'],
        severityFilter: 'high',
        cooldownMinutes: { low: 60, medium: 30, high: 10, critical: 0 },
      };
      await store.setAlertConfig(config);

      // Verify all data is present
      expect(await store.getMetricsCount()).toBe(1);
      expect((await store.getScalingState()).currentVcpu).toBe(4);
      expect((await store.getScalingHistory()).length).toBe(1);
      expect((await store.getAnomalyEvents()).total).toBe(1);
      expect(await store.getUsageDataCount()).toBe(1);
      expect(await store.getDailyAccumulatorState('2026-02-10')).not.toBeNull();
      expect((await store.getAlertConfig()).enabled).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty retrievals gracefully', async () => {
      const metrics = await store.getRecentMetrics();
      const history = await store.getScalingHistory();
      const events = await store.getAnomalyEvents();
      const usage = await store.getUsageData(7);
      const records = await store.getPredictionRecords();

      expect(metrics).toHaveLength(0);
      expect(history).toHaveLength(0);
      expect(events.total).toBe(0);
      expect(usage).toHaveLength(0);
      expect(records).toHaveLength(0);
    });

    it('should handle concurrent operations safely', async () => {
      const results = await Promise.all([
        store.pushMetric(createMetricPoint()),
        store.pushUsageData(createUsagePoint()),
        store.createAnomalyEvent(createAnomalyEvent()),
        store.addScalingHistory(createScalingEntry()),
      ]);

      expect(results).toHaveLength(4);
      expect(await store.getMetricsCount()).toBe(1);
      expect(await store.getUsageDataCount()).toBe(1);
    });

    it('should handle large data values', async () => {
      await store.pushMetric(
        createMetricPoint({
          cpuUsage: 9999,
          txPoolPending: 1000000,
          blockHeight: 999999999,
        })
      );

      const metrics = await store.getRecentMetrics();

      expect(metrics[0].cpuUsage).toBe(9999);
      expect(metrics[0].txPoolPending).toBe(1000000);
    });

    it('should handle rapid state updates', async () => {
      for (let i = 0; i < 10; i++) {
        await store.updateScalingState({ currentVcpu: i + 1 });
      }

      const state = await store.getScalingState();

      expect(state.currentVcpu).toBe(10);
    });
  });
});
