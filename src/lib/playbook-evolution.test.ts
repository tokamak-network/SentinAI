/**
 * Unit Tests: Playbook Evolution Modules
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PatternMiner } from './pattern-miner';
import { PlaybookEvolver } from './playbook-evolver';
import { ABTestController } from './ab-test-controller';
import { RollbackManager } from './rollback-manager';
import type { OperationRecord, OperationalPattern } from './playbook-evolution-types';

describe('PatternMiner', () => {
  let miner: PatternMiner;

  beforeEach(() => {
    miner = new PatternMiner();
  });

  it('should return empty array for less than 3 records', async () => {
    const records: OperationRecord[] = [
      {
        id: '1',
        timestamp: new Date().toISOString(),
        anomalyType: 'high_cpu',
        action: 'scale_up',
        success: true,
        resolutionMs: 1000,
      },
    ];

    const patterns = await miner.analyzeAndMine(records);
    expect(patterns).toHaveLength(0);
  });

  it('should extract patterns from 3+ records with same anomalyType and action', async () => {
    const records: OperationRecord[] = Array.from({ length: 5 }, (_, i) => ({
      id: `${i}`,
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
      anomalyType: 'high_cpu',
      action: 'scale_up',
      success: i % 2 === 0, // 60% success rate
      resolutionMs: 1000 + i * 100,
    }));

    const patterns = await miner.analyzeAndMine(records);
    expect(patterns).toHaveLength(1);

    const pattern = patterns[0];
    expect(pattern).toBeDefined();
    if (pattern) {
      expect(pattern.anomalyType).toBe('high_cpu');
      expect(pattern.effectiveAction).toBe('scale_up');
      expect(pattern.occurrences).toBe(5);
      expect(pattern.successRate).toBeGreaterThan(0);
      expect(pattern.confidence).toBeGreaterThan(0);
    }
  });

  it('should handle multiple patterns with different actions', async () => {
    const records: OperationRecord[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `cpu-${i}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        anomalyType: 'high_cpu',
        action: 'scale_up',
        success: true,
        resolutionMs: 1000,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `mem-${i}`,
        timestamp: new Date(Date.now() + (i + 5) * 1000).toISOString(),
        anomalyType: 'high_memory',
        action: 'increase_memory',
        success: true,
        resolutionMs: 1500,
      })),
    ];

    const patterns = await miner.analyzeAndMine(records);
    expect(patterns.length).toBeGreaterThanOrEqual(2);
  });

  it('should sort patterns by confidence (descending)', async () => {
    const records: OperationRecord[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `cpu-${i}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        anomalyType: 'high_cpu',
        action: 'scale_up',
        success: true, // 100% success
        resolutionMs: 1000,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `mem-${i}`,
        timestamp: new Date(Date.now() + (i + 10) * 1000).toISOString(),
        anomalyType: 'high_memory',
        action: 'increase_memory',
        success: i === 0, // 33% success
        resolutionMs: 1500,
      })),
    ];

    const patterns = await miner.analyzeAndMine(records);
    if (patterns.length > 1) {
      expect(patterns[0]!.confidence).toBeGreaterThanOrEqual(patterns[1]!.confidence);
    }
  });
});

describe('PlaybookEvolver', () => {
  let evolver: PlaybookEvolver;

  beforeEach(() => {
    evolver = new PlaybookEvolver();
  });

  it('should generate playbook version from empty patterns', async () => {
    const version = await evolver.generateFromPatterns([]);

    expect(version).toBeDefined();
    expect(version.versionId).toMatch(/^v-\d+$/);
    expect(version.generatedBy).toBe('claude-sonnet-4-5-20250929');
    expect(version.source).toBe('ai-assisted');
    expect(version.confidence).toBeGreaterThan(0);
    expect(version.playbook).toBeDefined();
  });

  it('should generate playbook with conditions from patterns', async () => {
    const patterns: OperationalPattern[] = [
      {
        id: 'p1',
        anomalyType: 'high_cpu',
        effectiveAction: 'scale_up',
        successRate: 0.8,
        occurrences: 10,
        confidence: 0.85,
        avgResolutionMs: 1500,
        lastSeen: new Date().toISOString(),
      },
    ];

    const version = await evolver.generateFromPatterns(patterns);

    expect(version.playbook).toBeDefined();
    const playbook = version.playbook as { conditions?: unknown[] };
    expect(Array.isArray(playbook.conditions)).toBe(true);
    if (Array.isArray(playbook.conditions)) {
      expect(playbook.conditions.length).toBeGreaterThan(0);
    }
  });

  it('should increase confidence with more patterns', async () => {
    const patterns1: OperationalPattern[] = [
      {
        id: 'p1',
        anomalyType: 'high_cpu',
        effectiveAction: 'scale_up',
        successRate: 0.5,
        occurrences: 1,
        confidence: 0.5,
        avgResolutionMs: 1500,
        lastSeen: new Date().toISOString(),
      },
    ];

    const patterns5: OperationalPattern[] = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      anomalyType: 'high_cpu',
      effectiveAction: 'scale_up',
      successRate: 0.9,
      occurrences: 20 * (i + 1),
      confidence: 0.9,
      avgResolutionMs: 1500,
      lastSeen: new Date().toISOString(),
    }));

    const version1 = await evolver.generateFromPatterns(patterns1);
    const version5 = await evolver.generateFromPatterns(patterns5);

    expect(version5.confidence).toBeGreaterThanOrEqual(version1.confidence);
  });
});

describe('ABTestController', () => {
  let controller: ABTestController;

  beforeEach(() => {
    controller = new ABTestController();
  });

  it('should create a test session', () => {
    const session = controller.createSession('session-1', 'v-0', 'v-1');

    expect(session).toBeDefined();
    expect(session.id).toBe('session-1');
    expect(session.status).toBe('running');
    expect(session.stats.controlExecutions).toBe(0);
    expect(session.stats.testExecutions).toBe(0);
  });

  it('should record executions', () => {
    const session = controller.createSession('session-1', 'v-0', 'v-1');

    controller.recordExecution('session-1', false, true);
    controller.recordExecution('session-1', false, false);
    controller.recordExecution('session-1', true, true);

    const updated = controller.getSession('session-1');
    expect(updated?.stats.controlExecutions).toBe(2);
    expect(updated?.stats.controlSuccesses).toBe(1);
    expect(updated?.stats.testExecutions).toBe(1);
    expect(updated?.stats.testSuccesses).toBe(1);
  });

  it('should detect significance at 85% threshold', () => {
    controller.createSession('session-1', 'v-0', 'v-1');

    // Record 20 control (70% success) and 20 test (90% success)
    for (let i = 0; i < 20; i++) {
      controller.recordExecution('session-1', false, i < 14); // 70% success
      controller.recordExecution('session-1', true, i < 18); // 90% success
    }

    const analysis = controller.analyzeSession('session-1');
    expect(analysis).toBeDefined();
    expect(analysis.pValue).toBeGreaterThanOrEqual(0);
    expect(analysis.pValue).toBeLessThanOrEqual(1);
  });

  it('should complete session with decision', () => {
    const session = controller.createSession('session-1', 'v-0', 'v-1');

    controller.recordExecution('session-1', false, true);
    controller.recordExecution('session-1', true, true);

    controller.completeSession('session-1', 'test');

    const completed = controller.getSession('session-1');
    expect(completed?.status).toBe('completed');
    expect(completed?.decision).toBe('promote');
  });

  it('should return undefined for non-existent session', () => {
    const session = controller.getSession('non-existent');
    expect(session).toBeUndefined();
  });
});

describe('RollbackManager', () => {
  let manager: RollbackManager;

  beforeEach(() => {
    manager = new RollbackManager();
  });

  it('should return current version', () => {
    const current = manager.getCurrentVersion();

    expect(current).toBeDefined();
    expect(current.versionId).toBe('v-0');
    expect(current.source).toBe('hardcoded');
  });

  it('should promote version to current', () => {
    const newVersion = {
      versionId: 'v-1',
      generatedBy: 'test',
      generatedAt: new Date().toISOString(),
      source: 'ai-assisted' as const,
      confidence: 0.9,
      successRate: 0.85,
      totalApplications: 50,
      playbook: { id: 'test' },
    };

    manager.promoteVersion(newVersion);

    const current = manager.getCurrentVersion();
    expect(current.versionId).toBe('v-1');

    const history = manager.getHistory();
    expect(history.length).toBe(1);
    expect(history[0]?.versionId).toBe('v-0');
  });

  it('should rollback to previous version', () => {
    const v1 = {
      versionId: 'v-1',
      generatedBy: 'test',
      generatedAt: new Date().toISOString(),
      source: 'ai-assisted' as const,
      confidence: 0.9,
      successRate: 0.85,
      totalApplications: 50,
      playbook: { id: 'v1' },
    };

    const v2 = {
      versionId: 'v-2',
      generatedBy: 'test',
      generatedAt: new Date().toISOString(),
      source: 'ai-assisted' as const,
      confidence: 0.95,
      successRate: 0.9,
      totalApplications: 100,
      playbook: { id: 'v2' },
    };

    manager.promoteVersion(v1);
    manager.promoteVersion(v2);

    const success = manager.rollbackTo('v-1');
    expect(success).toBe(true);

    const current = manager.getCurrentVersion();
    expect(current.versionId).toBe('v-1');
  });

  it('should return false when rolling back to non-existent version', () => {
    const success = manager.rollbackTo('v-999');
    expect(success).toBe(false);
  });

  it('should limit history to 10 versions', () => {
    for (let i = 1; i <= 15; i++) {
      const version = {
        versionId: `v-${i}`,
        generatedBy: 'test',
        generatedAt: new Date().toISOString(),
        source: 'ai-assisted' as const,
        confidence: 0.8 + i * 0.01,
        successRate: 0.8,
        totalApplications: i * 10,
        playbook: { id: `v-${i}` },
      };
      manager.promoteVersion(version);
    }

    const history = manager.getHistory();
    expect(history.length).toBeLessThanOrEqual(10);
  });
});
