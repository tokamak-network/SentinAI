/**
 * Abstract Playbook Layer - Integration Tests
 *
 * Tests three-layer playbook resolution:
 * 1. Redis dynamic playbooks (proposal-32 generated)
 * 2. Chain-specific playbooks (existing)
 * 3. Core abstract playbooks (hardcoded)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnomalyEvent } from '@/types/anomaly';
import { matchAbstractPlaybooks, resolvePlaybookActions, matchAndResolvePlaybook } from './abstract-playbook-matcher';
import { matchPlaybookWithLayers } from './playbook-matcher';
import { resourcePressure } from '@/playbooks/core/resource-pressure';
import { evaluateConditions } from '@/playbooks/evaluate';

// ============================================================
// Test Data
// ============================================================

const createAnomalyEvent = (overrides?: Partial<AnomalyEvent>): AnomalyEvent => ({
  id: 'evt-123',
  timestamp: Date.now(),
  status: 'active',
  alerts: [],
  anomalies: [
    {
      metric: 'cpuUsage',
      value: 95,
      zScore: 3.2,
      direction: 'spike',
      rule: 'threshold-breach',
      description: 'CPU usage above threshold',
      isAnomaly: true,
    },
  ],
  ...overrides,
});

const createL2AnomalyEvent = (overrides?: Partial<AnomalyEvent>): AnomalyEvent => ({
  ...createAnomalyEvent(),
  // L2 events use same metric names - the layer is determined by anomaly analysis
  anomalies: [
    {
      metric: 'cpuUsage',
      value: 95,
      zScore: 3.2,
      direction: 'spike',
      rule: 'threshold-breach',
      description: 'L2 CPU usage above threshold',
      isAnomaly: true,
    },
  ],
  ...overrides,
});

const createSyncStallEvent = (): AnomalyEvent => ({
  id: 'evt-sync-stall',
  timestamp: Date.now(),
  status: 'active',
  alerts: [],
  anomalies: [
    {
      metric: 'l2BlockHeight',
      value: 100,
      zScore: 2.8,
      direction: 'plateau',
      rule: 'plateau',
      description: 'L2 block height stalled',
      isAnomaly: true,
    },
  ],
});

// ============================================================
// Tests
// ============================================================

describe('Abstract Playbook Layer Integration', () => {
  describe('Condition Evaluation', () => {
    it('should match resource pressure condition (cpuUsage > 90)', () => {
      const event = createAnomalyEvent();
      const result = evaluateConditions(resourcePressure.conditions, event);
      expect(result).toBe(true);
    });

    it('should not match when threshold not exceeded', () => {
      const event = createAnomalyEvent({
        anomalies: [
          {
            metric: 'cpuUsage',
            value: 85,
            zScore: 1.5,
            direction: 'spike',
            rule: 'threshold-breach',
            description: 'CPU usage below threshold',
            isAnomaly: false,
          },
        ],
      });
      const result = evaluateConditions(resourcePressure.conditions, event);
      expect(result).toBe(false);
    });

    it('should return false for empty conditions (catch-all prevention)', () => {
      const event = createAnomalyEvent();
      const result = evaluateConditions([], event);
      expect(result).toBe(false);
    });
  });

  describe('Abstract Playbook Matching', () => {
    it('should match resource pressure playbook for high CPU', async () => {
      const event = createL2AnomalyEvent();
      const matches = await matchAbstractPlaybooks(event, 'l2');

      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(p => p.id === 'core-resource-pressure')).toBe(true);
    });

    it('should return empty array when no playbooks match', async () => {
      const event = createAnomalyEvent({
        anomalies: [
          {
            metric: 'unknownMetric',
            value: 50,
            zScore: 0.5,
            direction: 'spike',
            rule: 'threshold-breach',
            description: 'Unknown metric anomaly',
            isAnomaly: true,
          },
        ],
      });
      const matches = await matchAbstractPlaybooks(event, 'l2');

      expect(matches).toEqual([]);
    });

    it('should filter by node layer (l1 vs l2)', async () => {
      const event = createL2AnomalyEvent();

      const l2Matches = await matchAbstractPlaybooks(event, 'l2');
      const l1Matches = await matchAbstractPlaybooks(event, 'l1');

      // L2 event should match L2-applicable playbooks
      expect(l2Matches.length).toBeGreaterThanOrEqual(l1Matches.length);
    });
  });

  describe('Action Resolution', () => {
    it('should resolve abstract actions to concrete RemediationAction format', () => {
      const actions = resolvePlaybookActions(resourcePressure);

      expect(actions.length).toBeGreaterThan(0);
      expect(actions[0]).toHaveProperty('type');
      expect(actions[0]).toHaveProperty('target');
      expect(actions[0]).toHaveProperty('safetyLevel');
      expect(actions[0]).toHaveProperty('params');
    });

    it('should resolve targetRole to actual component name', () => {
      const actions = resolvePlaybookActions(resourcePressure);

      // All resolved actions should have a concrete target (no targetRole)
      expect(actions.every(a => !('targetRole' in a))).toBe(true);

      // All resolved actions should have valid targets
      expect(actions.every(a => typeof a.target === 'string' && a.target.length > 0)).toBe(true);
    });

    it('should use fallback actions when specified', () => {
      const primaryActions = resolvePlaybookActions(resourcePressure, 'primary');
      const fallbackActions = resolvePlaybookActions(resourcePressure, 'fallback');

      expect(primaryActions.length).toBeGreaterThan(0);

      // Fallback actions may be empty if not defined
      if (resourcePressure.fallback) {
        expect(fallbackActions.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Three-Layer Playbook Matching', () => {
    it('should return abstract playbook with source indicator', async () => {
      const event = createL2AnomalyEvent();
      const result = await matchAndResolvePlaybook(event);

      expect(result).not.toBeNull();
      expect(result?.source).toBe('abstract');
      expect(result?.actions.length).toBeGreaterThan(0);
      expect(result?.playbook).toHaveProperty('conditions');
    });

    it('should prefer abstract playbooks over chain-specific', async () => {
      const event = createL2AnomalyEvent();
      const result = await matchAndResolvePlaybook(event);

      // Resource pressure is a core abstract playbook, should be found
      expect(result?.source).toBe('abstract');
    });

    it('should include resolved actions for all playbooks', async () => {
      const event = createL2AnomalyEvent();
      const result = await matchAndResolvePlaybook(event);

      if (result) {
        expect(result.actions.length).toBeGreaterThan(0);
        expect(result.actions.every(a => a.type && a.target)).toBe(true);
      }
    });

    it('should handle events with no matching playbooks', async () => {
      const event = createAnomalyEvent({
        anomalies: [
          {
            metric: 'unknownMetric',
            value: 50,
            zScore: 0.5,
            direction: 'spike',
            rule: 'threshold-breach',
            description: 'Unknown metric anomaly',
            isAnomaly: true,
          },
        ],
      });
      const result = await matchAndResolvePlaybook(event);

      expect(result).toBeNull();
    });
  });

  describe('Unified Three-Layer Matcher', () => {
    it('should match and return playbook with actions', async () => {
      const event = createL2AnomalyEvent();
      const result = await matchPlaybookWithLayers(event);

      expect(result).not.toBeNull();
      expect(result?.actions.length).toBeGreaterThan(0);
      expect(result?.source).toBe('abstract');
    });

    it('should return both playbook and resolved actions', async () => {
      const event = createL2AnomalyEvent();
      const result = await matchPlaybookWithLayers(event);

      if (result) {
        expect(result.playbook).toBeDefined();
        expect(result.actions).toBeDefined();
        expect(Array.isArray(result.actions)).toBe(true);
        expect(['abstract', 'chain-specific']).toContain(result.source);
      }
    });

    it('should handle sync stall events', async () => {
      const event = createSyncStallEvent();
      const result = await matchPlaybookWithLayers(event);

      // Sync stall is a defined playbook, should match
      if (result) {
        expect(result.actions.length).toBeGreaterThan(0);
      }
    });

    it('should prefer abstract over chain-specific when both match', async () => {
      // Resource pressure matches both layers - abstract should be preferred
      const event = createL2AnomalyEvent();
      const result = await matchPlaybookWithLayers(event);

      // Result should exist
      expect(result).not.toBeNull();
      // Should prefer abstract layer
      expect(result?.source).toBe('abstract');
    });
  });

  describe('Edge Cases', () => {
    it('should handle events with multiple anomalies', async () => {
      const event = createAnomalyEvent({
        anomalies: [
          {
            metric: 'cpuUsage',
            value: 95,
            zScore: 3.2,
            direction: 'spike',
            rule: 'threshold-breach',
            description: 'CPU usage above threshold',
            isAnomaly: true,
          },
          {
            metric: 'memoryUsage',
            value: 92,
            zScore: 2.9,
            direction: 'spike',
            rule: 'threshold-breach',
            description: 'Memory usage above threshold',
            isAnomaly: true,
          },
        ],
      });
      const result = await matchPlaybookWithLayers(event);

      expect(result).not.toBeNull();
    });

    it('should handle events with extreme values', async () => {
      const event = createL2AnomalyEvent({
        anomalies: [
          {
            metric: 'cpuUsage',
            value: 100,
            zScore: 4.5,
            direction: 'spike',
            rule: 'threshold-breach',
            description: 'CPU at maximum',
            isAnomaly: true,
          },
        ],
      });
      const result = await matchPlaybookWithLayers(event);

      expect(result).not.toBeNull();
    });

    it('should maintain consistent action structure across layers', async () => {
      const event = createL2AnomalyEvent();
      const abstractResult = await matchAndResolvePlaybook(event);

      if (abstractResult) {
        expect(abstractResult.actions.every(a => a.type && a.target && a.safetyLevel !== undefined)).toBe(true);
      }
    });
  });
});
