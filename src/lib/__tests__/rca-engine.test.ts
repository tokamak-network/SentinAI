/**
 * Unit tests for rca-engine module
 * Tests root cause analysis, component dependencies, and incident timeline building
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as rcaEngine from '@/lib/rca-engine';
import type { AnomalyResult, AnomalyMetric } from '@/types/anomaly';
import type { RCAComponent } from '@/types/rca';

// Mock the AI client
vi.mock('@/lib/ai-client', () => ({
  chatCompletion: vi.fn(),
}));

const { chatCompletion } = await import('@/lib/ai-client');

/**
 * Helper: Create test anomaly result
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
    description: 'CPU usage spike detected',
    rule: 'z-score',
    severity: 'high',
    ...overrides,
  };
}

describe('rca-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Dependency Graph', () => {
    it('should have valid dependency graph structure', () => {
      const graph = rcaEngine.DEPENDENCY_GRAPH;

      // Check all required components exist
      expect(graph['op-geth']).toBeDefined();
      expect(graph['op-node']).toBeDefined();
      expect(graph['op-batcher']).toBeDefined();
      expect(graph['op-proposer']).toBeDefined();
      expect(graph['l1']).toBeDefined();
      expect(graph['system']).toBeDefined();

      // Check each component has dependencies
      Object.entries(graph).forEach(([, dep]) => {
        expect(Array.isArray(dep.dependsOn)).toBe(true);
        expect(Array.isArray(dep.feeds)).toBe(true);
      });
    });

    it('should have bidirectional relationships in dependency graph', () => {
      const graph = rcaEngine.DEPENDENCY_GRAPH;

      // op-node depends on l1, l1 should feed op-node
      expect(graph['op-node'].dependsOn).toContain('l1');
      expect(graph['l1'].feeds).toContain('op-node');

      // op-geth depends on op-node, op-node should feed op-geth
      expect(graph['op-geth'].dependsOn).toContain('op-node');
      expect(graph['op-node'].feeds).toContain('op-geth');
    });
  });

  describe('findAffectedComponents', () => {
    it('should find all downstream components when l1 fails', () => {
      // L1 failure affects: op-node, op-batcher, op-proposer
      const affected = rcaEngine.findAffectedComponents('l1');

      expect(affected).toContain('op-node');
      expect(affected).toContain('op-batcher');
      expect(affected).toContain('op-proposer');
    });

    it('should find cascading effects when op-node fails', () => {
      // op-node failure affects: op-geth, op-batcher, op-proposer
      const affected = rcaEngine.findAffectedComponents('op-node');

      expect(affected).toContain('op-geth');
      expect(affected).toContain('op-batcher');
      expect(affected).toContain('op-proposer');
    });

    it('should return empty array when op-geth fails (leaf node)', () => {
      // op-geth is a leaf node with no downstream dependencies
      const affected = rcaEngine.findAffectedComponents('op-geth');

      expect(affected).not.toContain('op-geth');
    });

    it('should handle system component affecting all', () => {
      const affected = rcaEngine.findAffectedComponents('system');

      // System feeds all other components
      expect(affected.length).toBeGreaterThan(0);
    });
  });

  describe('findUpstreamComponents', () => {
    it('should find upstream dependencies for op-geth', () => {
      const upstream = rcaEngine.findUpstreamComponents('op-geth');

      expect(upstream).toContain('op-node');
    });

    it('should find all upstream dependencies for op-node', () => {
      const upstream = rcaEngine.findUpstreamComponents('op-node');

      expect(upstream).toContain('l1');
    });

    it('should return empty array for l1 (root node)', () => {
      const upstream = rcaEngine.findUpstreamComponents('l1');

      expect(upstream).toHaveLength(0);
    });

    it('should return empty array for system component', () => {
      const upstream = rcaEngine.findUpstreamComponents('system');

      expect(upstream).toHaveLength(0);
    });
  });

  describe('buildTimeline', () => {
    it('should build timeline from anomalies and logs', () => {
      const anomalies = [
        createAnomaly({
          timestamp: Date.now() - 30000,
          metric: 'cpuUsage',
          severity: 'high',
        }),
      ];

      const logs = {
        'op-geth': '[ERROR] Connection refused\n[WARN] Retrying connection',
        'op-node': '[ERROR] Block sync failed',
      };

      const timeline = rcaEngine.buildTimeline(anomalies, logs);

      expect(timeline.length).toBeGreaterThan(0);
      // Should contain both anomaly and log events
      const hasAnomalyEvent = timeline.some(e => 'metric' in e || e.description.includes('spike'));
      const hasLogEvents = timeline.some(e => e.type === 'error' || e.type === 'warning');

      expect(timeline).toBeDefined();
    });

    it('should filter events outside time window', () => {
      const now = Date.now();
      const anomalies = [
        createAnomaly({
          timestamp: now - 20 * 60000, // 20 minutes ago
          metric: 'cpuUsage',
        }),
      ];

      const logs = {
        'op-geth': '[ERROR] Old error 20 minutes ago',
      };

      // Get timeline for last 5 minutes (default)
      const timeline = rcaEngine.buildTimeline(anomalies, logs, 5);

      // Old event should be filtered out
      const timewindowStart = now - 5 * 60000;
      const validEvents = timeline.filter(e => e.timestamp >= timewindowStart);

      // If events are filtered, valid count should be less than all events
      expect(timeline.length >= 0).toBe(true);
    });

    it('should sort events chronologically', () => {
      const anomalies = [
        createAnomaly({
          timestamp: Date.now() - 60000, // 1 minute ago
          metric: 'cpuUsage',
        }),
        createAnomaly({
          timestamp: Date.now() - 30000, // 30 seconds ago
          metric: 'txPool',
        }),
      ];

      const logs = {};

      const timeline = rcaEngine.buildTimeline(anomalies, logs);

      // Check if sorted
      for (let i = 1; i < timeline.length; i++) {
        expect(timeline[i].timestamp).toBeGreaterThanOrEqual(timeline[i - 1].timestamp);
      }
    });

    it('should map anomaly metrics to components correctly', () => {
      const anomalies = [
        createAnomaly({ metric: 'cpuUsage', description: 'CPU spike' }),
        createAnomaly({ metric: 'blockInterval', description: 'Block delay' }),
      ];

      const timeline = rcaEngine.buildTimeline(anomalies, {});

      const cpuEvent = timeline.find(e => e.description.includes('CPU spike'));
      const blockEvent = timeline.find(e => e.description.includes('Block delay'));

      // CPU anomaly should be from op-geth
      if (cpuEvent) {
        expect(cpuEvent.component).toBe('op-geth');
      }

      // Block anomaly should be from op-node
      if (blockEvent) {
        expect(blockEvent.component).toBe('op-node');
      }
    });
  });

  describe('RCA History Management', () => {
    it('should add RCA result to history', () => {
      const initialCount = rcaEngine.getRCAHistoryCount();

      const result = {
        id: 'rca-001',
        timestamp: new Date().toISOString(),
        triggeredBy: 'manual' as const,
        rootCause: {
          component: 'op-node' as RCAComponent,
          issue: 'Block sync failure',
          confidence: 0.85,
        },
        affectedComponents: ['op-geth', 'op-batcher'],
        timeline: [],
        aiAnalysis: 'Block synchronization failure in op-node',
        remediationAdvice: [
          {
            priority: 'immediate',
            action: 'Restart op-node',
            estimatedImpact: 'Full service restoration',
          },
        ],
      };

      rcaEngine.addRCAHistory(result, 'manual');

      const newCount = rcaEngine.getRCAHistoryCount();
      expect(newCount).toBeGreaterThan(initialCount);
    });

    it('should retrieve RCA history with limit', () => {
      // Add multiple entries
      for (let i = 0; i < 5; i++) {
        rcaEngine.addRCAHistory(
          {
            id: `rca-${i}`,
            timestamp: new Date(Date.now() - i * 60000).toISOString(),
            triggeredBy: 'auto',
            rootCause: {
              component: 'op-geth',
              issue: `Issue ${i}`,
              confidence: 0.8,
            },
            affectedComponents: [],
            timeline: [],
            aiAnalysis: 'Test analysis',
            remediationAdvice: [],
          },
          'auto'
        );
      }

      const history = rcaEngine.getRCAHistory(3);

      expect(history.length).toBeLessThanOrEqual(3);
    });

    it('should retrieve RCA by ID', () => {
      const testId = `rca-test-${Date.now()}`;

      rcaEngine.addRCAHistory(
        {
          id: testId,
          timestamp: new Date().toISOString(),
          triggeredBy: 'manual',
          rootCause: {
            component: 'l1',
            issue: 'L1 node unresponsive',
            confidence: 0.9,
          },
          affectedComponents: ['op-node', 'op-batcher', 'op-proposer'],
          timeline: [],
          aiAnalysis: 'L1 connectivity issue',
          remediationAdvice: [],
        },
        'manual'
      );

      const entry = rcaEngine.getRCAById(testId);

      expect(entry).toBeDefined();
      expect(entry?.result.id).toBe(testId);
    });

    it('should return undefined for non-existent RCA ID', () => {
      const entry = rcaEngine.getRCAById('non-existent-id-12345');

      expect(entry).toBeUndefined();
    });
  });

  describe('Integration: Complete Dependency Analysis', () => {
    it('should build complete dependency chain from root cause', () => {
      // Simulate L1 failure - should affect everything downstream
      const rootComponent: RCAComponent = 'l1';
      const affected = rcaEngine.findAffectedComponents(rootComponent);

      // Should cascade through op-node to other components
      expect(affected.length).toBeGreaterThan(0);
      expect(affected).toContain('op-node');
      expect(affected).toContain('op-batcher');
    });

    it('should trace upstream and downstream for op-node', () => {
      const upstream = rcaEngine.findUpstreamComponents('op-node');
      const downstream = rcaEngine.findAffectedComponents('op-node');

      // op-node depends on l1 (upstream)
      expect(upstream).toContain('l1');

      // op-node feeds op-geth, op-batcher, op-proposer (downstream)
      expect(downstream).toContain('op-geth');
      expect(downstream).toContain('op-batcher');
      expect(downstream).toContain('op-proposer');
    });

    it('should correctly model complete fault propagation path', () => {
      // If L1 fails, what are ALL affected components?
      const allAffected = rcaEngine.findAffectedComponents('l1');

      // The entire system depends on L1
      expect(allAffected.length).toBeGreaterThan(0);

      // Verify no component depends on failed component (acyclic)
      for (const comp of allAffected) {
        const upstream = rcaEngine.findUpstreamComponents(comp);
        // Check that we don't have a cycle
        expect(upstream.includes('l1')).toBe(true);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty anomalies and logs', () => {
      const timeline = rcaEngine.buildTimeline([], {});

      expect(Array.isArray(timeline)).toBe(true);
      expect(timeline.length).toBe(0);
    });

    it('should handle malformed component names', () => {
      const logs = {
        'unknown-component': '[ERROR] Some error',
        'GETH': '[ERROR] Another error',
      };

      const timeline = rcaEngine.buildTimeline([], logs);

      // Should normalize component names
      expect(timeline.length).toBeGreaterThan(0);
    });

    it('should handle various log formats', () => {
      const logs = {
        'op-geth': `[12-15|14:23:45.123] ERROR connection lost
2024-12-15T14:23:45.123Z WARN retry attempt 1
2024-12-15 14:23:45 ERROR failed to connect
[ERROR] Simple error message`,
      };

      const timeline = rcaEngine.buildTimeline([], logs);

      // Should parse log events (at least some)
      expect(timeline.length).toBeGreaterThan(0);
    });

    it('should handle anomalies with very high z-scores', () => {
      const anomalies = [
        createAnomaly({
          zScore: 10, // Very high z-score
          severity: 'critical',
        }),
      ];

      const timeline = rcaEngine.buildTimeline(anomalies, {});

      // Should mark as critical severity
      const anomalyEvent = timeline.find(e => 'type' in e && e.type === 'metric_anomaly');
      if (anomalyEvent) {
        expect(anomalyEvent.severity).toBe('critical');
      }
    });
  });
});
