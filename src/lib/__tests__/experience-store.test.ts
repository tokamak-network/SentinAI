/**
 * Experience Store Tests
 *
 * Verifies recording, retrieval, filtering, and stats calculation
 * for the operational knowledge accumulation store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExperienceEntry } from '@/types/experience';

// In-memory backing store for tests
let experienceLog: ExperienceEntry[] = [];

vi.mock('@/lib/redis-store', () => ({
  getStore: () => ({
    addExperience: async (entry: ExperienceEntry) => {
      experienceLog.unshift(entry);
      if (experienceLog.length > 5000) experienceLog.pop();
    },
    getExperience: async (limit: number = 50, offset: number = 0) => {
      return experienceLog.slice(offset, offset + limit);
    },
    getExperienceByInstance: async (instanceId: string, limit: number = 50) => {
      return experienceLog.filter(e => e.instanceId === instanceId).slice(0, limit);
    },
    getExperienceCount: async () => experienceLog.length,
  }),
}));

vi.mock('@/lib/trace-context', () => ({
  getTraceId: () => 'tr-test-0000',
}));

vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks
import { recordExperience, getExperienceLog, getExperienceByInstance, getExperienceStats } from '@/lib/experience-store';

function makeInput(overrides: Partial<Omit<ExperienceEntry, 'id' | 'timestamp' | 'traceId'>> = {}) {
  return {
    instanceId: 'inst-1',
    protocolId: 'opstack',
    category: 'scaling-action' as const,
    trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 },
    action: 'scale_up 2→4 vCPU',
    outcome: 'success' as const,
    resolutionMs: 45000,
    metricsSnapshot: { cpuUsage: 85, gasUsedRatio: 0.7 },
    ...overrides,
  };
}

describe('experience-store', () => {
  beforeEach(() => {
    experienceLog = [];
  });

  describe('recordExperience', () => {
    it('should record entry and auto-assign id, timestamp, and traceId', async () => {
      const entry = await recordExperience(makeInput());

      expect(entry.id).toBeDefined();
      expect(entry.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(entry.timestamp).toBeDefined();
      expect(entry.traceId).toBe('tr-test-0000');
      expect(entry.category).toBe('scaling-action');
      expect(entry.instanceId).toBe('inst-1');
      expect(entry.protocolId).toBe('opstack');
      expect(entry.action).toBe('scale_up 2→4 vCPU');
      expect(entry.outcome).toBe('success');
      expect(entry.resolutionMs).toBe(45000);
    });

    it('should persist entry in the store', async () => {
      await recordExperience(makeInput());
      const log = await getExperienceLog(10);

      expect(log).toHaveLength(1);
      expect(log[0].category).toBe('scaling-action');
    });

    it('should store entries in newest-first order', async () => {
      await recordExperience(makeInput({ action: 'first' }));
      await recordExperience(makeInput({ action: 'second' }));

      const log = await getExperienceLog(10);
      expect(log[0].action).toBe('second');
      expect(log[1].action).toBe('first');
    });
  });

  describe('getExperienceLog', () => {
    it('should return empty array when no entries exist', async () => {
      const log = await getExperienceLog();
      expect(log).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await recordExperience(makeInput({ action: `action-${i}` }));
      }
      const log = await getExperienceLog(3);
      expect(log).toHaveLength(3);
    });

    it('should respect offset parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await recordExperience(makeInput({ action: `action-${i}` }));
      }
      const log = await getExperienceLog(2, 2);
      expect(log).toHaveLength(2);
      // Entries are newest-first: action-4, action-3, action-2, action-1, action-0
      expect(log[0].action).toBe('action-2');
      expect(log[1].action).toBe('action-1');
    });
  });

  describe('getExperienceByInstance', () => {
    it('should filter entries by instanceId', async () => {
      await recordExperience(makeInput({ instanceId: 'inst-a' }));
      await recordExperience(makeInput({ instanceId: 'inst-b' }));
      await recordExperience(makeInput({ instanceId: 'inst-a' }));

      const aEntries = await getExperienceByInstance('inst-a');
      expect(aEntries).toHaveLength(2);
      expect(aEntries.every(e => e.instanceId === 'inst-a')).toBe(true);
    });

    it('should return empty array for unknown instanceId', async () => {
      await recordExperience(makeInput({ instanceId: 'inst-a' }));
      const entries = await getExperienceByInstance('inst-unknown');
      expect(entries).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await recordExperience(makeInput({ instanceId: 'inst-x' }));
      }
      const entries = await getExperienceByInstance('inst-x', 3);
      expect(entries).toHaveLength(3);
    });
  });

  describe('getExperienceStats', () => {
    it('should return zero stats when no entries exist', async () => {
      const stats = await getExperienceStats();
      expect(stats).toEqual({
        totalOperations: 0,
        successRate: 0,
        avgResolutionMs: 0,
        topCategories: [],
        operatingDays: 0,
      });
    });

    it('should calculate correct success rate', async () => {
      await recordExperience(makeInput({ outcome: 'success' }));
      await recordExperience(makeInput({ outcome: 'success' }));
      await recordExperience(makeInput({ outcome: 'failure' }));

      const stats = await getExperienceStats();
      expect(stats.totalOperations).toBe(3);
      expect(stats.successRate).toBeCloseTo(2 / 3, 5);
    });

    it('should calculate correct average resolution time', async () => {
      await recordExperience(makeInput({ resolutionMs: 30000 }));
      await recordExperience(makeInput({ resolutionMs: 60000 }));
      await recordExperience(makeInput({ resolutionMs: 90000 }));

      const stats = await getExperienceStats();
      expect(stats.avgResolutionMs).toBe(60000);
    });

    it('should aggregate top categories', async () => {
      await recordExperience(makeInput({ category: 'scaling-action' }));
      await recordExperience(makeInput({ category: 'scaling-action' }));
      await recordExperience(makeInput({ category: 'anomaly-resolution' }));
      await recordExperience(makeInput({ category: 'rca-diagnosis' }));

      const stats = await getExperienceStats();
      expect(stats.topCategories).toHaveLength(3);
      expect(stats.topCategories[0]).toEqual({ category: 'scaling-action', count: 2 });
    });

    it('should calculate operating days as at least 1', async () => {
      await recordExperience(makeInput());

      const stats = await getExperienceStats();
      expect(stats.operatingDays).toBeGreaterThanOrEqual(1);
    });

    it('should handle all categories', async () => {
      await recordExperience(makeInput({ category: 'scaling-action' }));
      await recordExperience(makeInput({ category: 'anomaly-resolution' }));
      await recordExperience(makeInput({ category: 'rca-diagnosis' }));
      await recordExperience(makeInput({ category: 'remediation' }));

      const stats = await getExperienceStats();
      expect(stats.totalOperations).toBe(4);
      expect(stats.topCategories).toHaveLength(4);
    });
  });
});
