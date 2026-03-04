import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExperienceEntry } from '@/types/experience';

let experienceLog: ExperienceEntry[] = [];

vi.mock('@/lib/redis-store', () => ({
  getStore: () => ({
    addExperience: async (entry: ExperienceEntry) => {
      experienceLog.unshift(entry);
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

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { aggregatePatterns, getRecommendations } from '@/lib/collective-intelligence';

const makeEntry = (overrides: Partial<ExperienceEntry> = {}): ExperienceEntry => ({
  id: `exp-${Math.random().toString(36).slice(2)}`,
  instanceId: 'inst-1',
  protocolId: 'opstack',
  timestamp: new Date().toISOString(),
  category: 'scaling-action',
  trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 },
  action: 'scale_up',
  outcome: 'success',
  resolutionMs: 45000,
  metricsSnapshot: { cpuUsage: 85 },
  ...overrides,
});

describe('collective-intelligence', () => {
  beforeEach(() => {
    experienceLog = [];
  });

  describe('aggregatePatterns', () => {
    it('should return empty library when no entries exist', async () => {
      const result = await aggregatePatterns();
      expect(result.patterns).toEqual([]);
      expect(result.totalInstances).toBe(0);
    });

    it('should aggregate patterns from a single instance', async () => {
      experienceLog = Array.from({ length: 5 }, () => makeEntry());
      const result = await aggregatePatterns();
      expect(result.totalInstances).toBe(1);
      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0].instanceCount).toBe(1);
      expect(result.patterns[0].totalOccurrences).toBe(5);
    });

    it('should merge patterns from multiple instances', async () => {
      experienceLog = [
        ...Array.from({ length: 5 }, () => makeEntry({ instanceId: 'inst-1' })),
        ...Array.from({ length: 5 }, () => makeEntry({ instanceId: 'inst-2' })),
      ];
      const result = await aggregatePatterns();
      expect(result.totalInstances).toBe(2);
      expect(result.patterns.length).toBe(1); // same signature → merged
      expect(result.patterns[0].instanceCount).toBe(2);
      expect(result.patterns[0].totalOccurrences).toBe(10);
    });

    it('should boost confidence for multi-instance patterns', async () => {
      const singleInstanceEntries = Array.from({ length: 5 }, () =>
        makeEntry({ instanceId: 'inst-1' }),
      );
      experienceLog = singleInstanceEntries;
      const singleResult = await aggregatePatterns();

      experienceLog = [
        ...Array.from({ length: 5 }, () => makeEntry({ instanceId: 'inst-1' })),
        ...Array.from({ length: 5 }, () => makeEntry({ instanceId: 'inst-2' })),
        ...Array.from({ length: 5 }, () => makeEntry({ instanceId: 'inst-3' })),
      ];
      const multiResult = await aggregatePatterns();

      expect(multiResult.patterns[0].aggregateConfidence)
        .toBeGreaterThan(singleResult.patterns[0].aggregateConfidence);
    });

    it('should keep separate patterns for different signatures', async () => {
      experienceLog = [
        ...Array.from({ length: 5 }, () =>
          makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 }, action: 'scale_up' }),
        ),
        ...Array.from({ length: 5 }, () =>
          makeEntry({
            trigger: { type: 'threshold', metric: 'gasUsedRatio', value: 0.9 },
            action: 'alert',
          }),
        ),
      ];
      const result = await aggregatePatterns();
      expect(result.patterns.length).toBe(2);
    });

    it('should calculate weighted success rate correctly', async () => {
      experienceLog = [
        ...Array.from({ length: 4 }, () =>
          makeEntry({ instanceId: 'inst-1', outcome: 'success' }),
        ),
        ...Array.from({ length: 1 }, () =>
          makeEntry({ instanceId: 'inst-1', outcome: 'failure' }),
        ),
        ...Array.from({ length: 3 }, () =>
          makeEntry({ instanceId: 'inst-2', outcome: 'success' }),
        ),
      ];
      const result = await aggregatePatterns();
      // inst-1: 5 entries, 4/5 success = 0.8
      // inst-2: 3 entries, 3/3 success = 1.0
      // weighted: (0.8*5 + 1.0*3) / 8 = 7/8 = 0.875
      expect(result.patterns[0].successRate).toBeCloseTo(0.875, 2);
    });
  });

  describe('getRecommendations', () => {
    it('should return empty when no matching patterns', async () => {
      const result = await getRecommendations('z-score', 'opstack');
      expect(result).toEqual([]);
    });

    it('should return matching recommendations', async () => {
      experienceLog = Array.from({ length: 5 }, () => makeEntry());
      const result = await getRecommendations('z-score', 'opstack');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].source).toBe('collective');
      expect(result[0].action).toBe('scale_up');
    });

    it('should return at most 3 recommendations', async () => {
      experienceLog = [
        ...Array.from({ length: 5 }, () =>
          makeEntry({ action: 'scale_up', trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.0 } }),
        ),
        ...Array.from({ length: 5 }, () =>
          makeEntry({ action: 'scale_down', trigger: { type: 'z-score', metric: 'cpuUsage', value: 1.0 } }),
        ),
        ...Array.from({ length: 5 }, () =>
          makeEntry({ action: 'alert', trigger: { type: 'z-score', metric: 'cpuUsage', value: 2.0 } }),
        ),
        ...Array.from({ length: 5 }, () =>
          makeEntry({ action: 'restart', trigger: { type: 'z-score', metric: 'cpuUsage', value: 4.0 } }),
        ),
      ];
      const result = await getRecommendations('z-score', 'opstack');
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('should filter by protocolId', async () => {
      experienceLog = [
        ...Array.from({ length: 5 }, () => makeEntry({ protocolId: 'opstack' })),
        ...Array.from({ length: 5 }, () => makeEntry({ protocolId: 'zkstack' })),
      ];
      const result = await getRecommendations('z-score', 'zkstack');
      expect(result.length).toBeGreaterThan(0);
      // Recommendations should only come from zkstack-compatible patterns
    });
  });
});
