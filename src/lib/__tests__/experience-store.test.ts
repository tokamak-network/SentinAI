/**
 * Experience Store Tests
 *
 * Verifies recording, retrieval, filtering, and stats calculation
 * for the operational knowledge accumulation store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExperienceEntry, LifetimeStats } from '@/types/experience';

// In-memory backing store for tests
let experienceLog: ExperienceEntry[] = [];
const lifetimeStatsMap = new Map<string, LifetimeStats>();

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
    incrementLifetimeStats: async (instanceId: string, entry: ExperienceEntry) => {
      for (const id of [instanceId, '_global']) {
        const existing = lifetimeStatsMap.get(id);
        if (existing) {
          existing.totalOps += 1;
          if (entry.outcome === 'success') existing.successCount += 1;
          else if (entry.outcome === 'failure') existing.failureCount += 1;
          else existing.partialCount += 1;
          existing.totalResolutionMs += entry.resolutionMs;
          existing.lastSeenAt = entry.timestamp;
          existing.categories[entry.category] = (existing.categories[entry.category] || 0) + 1;
        } else {
          lifetimeStatsMap.set(id, {
            totalOps: 1,
            successCount: entry.outcome === 'success' ? 1 : 0,
            failureCount: entry.outcome === 'failure' ? 1 : 0,
            partialCount: entry.outcome === 'partial' ? 1 : 0,
            totalResolutionMs: entry.resolutionMs,
            firstSeenAt: entry.timestamp,
            lastSeenAt: entry.timestamp,
            categories: { [entry.category]: 1 },
          });
        }
      }
    },
    getLifetimeStats: async (instanceId: string) => {
      return lifetimeStatsMap.get(instanceId) ?? null;
    },
    getGlobalLifetimeStats: async () => {
      return lifetimeStatsMap.get('_global') ?? null;
    },
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
import {
  recordExperience, getExperienceLog, getExperienceByInstance,
  getExperienceStats, getLifetimeStats, lifetimeToExperienceStats,
} from '@/lib/experience-store';

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
    lifetimeStatsMap.clear();
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

  describe('lifetime stats', () => {
    it('should accumulate lifetime stats on recordExperience', async () => {
      await recordExperience(makeInput({ instanceId: 'inst-1', outcome: 'success' }));
      await recordExperience(makeInput({ instanceId: 'inst-1', outcome: 'failure' }));
      await recordExperience(makeInput({ instanceId: 'inst-1', outcome: 'partial' }));

      const lt = await getLifetimeStats('inst-1');
      expect(lt).not.toBeNull();
      expect(lt!.totalOps).toBe(3);
      expect(lt!.successCount).toBe(1);
      expect(lt!.failureCount).toBe(1);
      expect(lt!.partialCount).toBe(1);
    });

    it('should track categories separately', async () => {
      await recordExperience(makeInput({ instanceId: 'inst-1', category: 'scaling-action' }));
      await recordExperience(makeInput({ instanceId: 'inst-1', category: 'scaling-action' }));
      await recordExperience(makeInput({ instanceId: 'inst-1', category: 'security-alert' }));

      const lt = await getLifetimeStats('inst-1');
      expect(lt!.categories['scaling-action']).toBe(2);
      expect(lt!.categories['security-alert']).toBe(1);
    });

    it('should keep firstSeenAt fixed and update lastSeenAt', async () => {
      await recordExperience(makeInput({ instanceId: 'inst-1' }));
      const lt1 = await getLifetimeStats('inst-1');
      const firstSeen = lt1!.firstSeenAt;

      await recordExperience(makeInput({ instanceId: 'inst-1' }));
      const lt2 = await getLifetimeStats('inst-1');
      expect(lt2!.firstSeenAt).toBe(firstSeen);
      expect(new Date(lt2!.lastSeenAt).getTime()).toBeGreaterThanOrEqual(new Date(firstSeen).getTime());
    });

    it('should isolate stats per instance', async () => {
      await recordExperience(makeInput({ instanceId: 'inst-a' }));
      await recordExperience(makeInput({ instanceId: 'inst-a' }));
      await recordExperience(makeInput({ instanceId: 'inst-b' }));

      const a = await getLifetimeStats('inst-a');
      const b = await getLifetimeStats('inst-b');
      expect(a!.totalOps).toBe(2);
      expect(b!.totalOps).toBe(1);
    });

    it('should return null for unknown instance', async () => {
      const lt = await getLifetimeStats('unknown');
      expect(lt).toBeNull();
    });

    it('should accumulate totalResolutionMs', async () => {
      await recordExperience(makeInput({ instanceId: 'inst-1', resolutionMs: 30000 }));
      await recordExperience(makeInput({ instanceId: 'inst-1', resolutionMs: 60000 }));

      const lt = await getLifetimeStats('inst-1');
      expect(lt!.totalResolutionMs).toBe(90000);
    });

    it('lifetimeToExperienceStats should convert correctly', () => {
      const lt: LifetimeStats = {
        totalOps: 100,
        successCount: 80,
        failureCount: 15,
        partialCount: 5,
        totalResolutionMs: 5000000,
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-04-01T00:00:00.000Z',
        categories: { 'scaling-action': 60, 'security-alert': 40 },
      };

      const stats = lifetimeToExperienceStats(lt);
      expect(stats.totalOperations).toBe(100);
      expect(stats.successRate).toBe(0.8);
      expect(stats.avgResolutionMs).toBe(50000);
      expect(stats.operatingDays).toBe(90); // Jan 1 to Apr 1
      expect(stats.topCategories[0]).toEqual({ category: 'scaling-action', count: 60 });
      expect(stats.topCategories[1]).toEqual({ category: 'security-alert', count: 40 });
    });
  });
});
