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

vi.mock('@/lib/trace-context', () => ({
  getTraceId: () => 'tr-test-transfer',
}));

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { extractTransferablePatterns, bootstrapNewAgent } from '@/lib/experience-transfer';

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

describe('experience-transfer', () => {
  beforeEach(() => {
    experienceLog = [];
  });

  describe('extractTransferablePatterns', () => {
    it('should return empty array when no entries exist', async () => {
      const result = await extractTransferablePatterns('opstack');
      expect(result).toEqual([]);
    });

    it('should return empty when entries exist but below thresholds', async () => {
      // Only 3 entries — below MIN_OCCURRENCES=5
      experienceLog = Array.from({ length: 3 }, () => makeEntry());
      const result = await extractTransferablePatterns('opstack');
      expect(result).toEqual([]);
    });

    it('should extract patterns meeting confidence and occurrence thresholds', async () => {
      // 10 identical successful entries → high confidence, occurrences=10
      experienceLog = Array.from({ length: 20 }, () => makeEntry());
      const result = await extractTransferablePatterns('opstack');
      expect(result.length).toBe(1);
      expect(result[0].occurrences).toBe(20);
      expect(result[0].successRate).toBe(1.0);
      expect(result[0].sourceProtocol).toBe('opstack');
    });

    it('should filter by protocolId', async () => {
      experienceLog = [
        ...Array.from({ length: 20 }, () => makeEntry({ protocolId: 'opstack' })),
        ...Array.from({ length: 20 }, () => makeEntry({ protocolId: 'zkstack' })),
      ];
      const result = await extractTransferablePatterns('opstack');
      // All patterns should be from opstack only
      for (const p of result) {
        expect(p.sourceProtocol).toBe('opstack');
      }
    });

    it('should strip instance-specific data', async () => {
      experienceLog = Array.from({ length: 20 }, () => makeEntry());
      const result = await extractTransferablePatterns('opstack');
      expect(result.length).toBeGreaterThan(0);
      for (const p of result) {
        // TransferablePattern should not have instanceId, traceId, etc.
        expect(p).not.toHaveProperty('instanceId');
        expect(p).not.toHaveProperty('traceId');
        expect(p).not.toHaveProperty('metricsSnapshot');
      }
    });

    it('should exclude low-confidence patterns', async () => {
      // Mix of success and failure entries → lower confidence
      experienceLog = [
        ...Array.from({ length: 3 }, () => makeEntry({ outcome: 'success' })),
        ...Array.from({ length: 4 }, () => makeEntry({ outcome: 'failure' })),
      ];
      const result = await extractTransferablePatterns('opstack');
      // With 3/7 success rate → low confidence, should be filtered out
      for (const p of result) {
        expect(p.confidence).toBeGreaterThanOrEqual(0.7);
      }
    });
  });

  describe('bootstrapNewAgent', () => {
    it('should return zero patterns when source has no experience', async () => {
      const result = await bootstrapNewAgent('inst-new', 'opstack');
      expect(result.patternsTransferred).toBe(0);
      expect(result.sourceProtocol).toBe('opstack');
      expect(result.discountApplied).toBe(0.5);
      expect(result.patterns).toEqual([]);
    });

    it('should apply 50% confidence discount to transferred patterns', async () => {
      experienceLog = Array.from({ length: 20 }, () => makeEntry());
      const original = await extractTransferablePatterns('opstack');
      expect(original.length).toBeGreaterThan(0);

      const result = await bootstrapNewAgent('inst-new', 'opstack');
      expect(result.patternsTransferred).toBe(original.length);

      for (let i = 0; i < result.patterns.length; i++) {
        expect(result.patterns[i].confidence).toBeCloseTo(
          original[i].confidence * 0.5,
          5,
        );
      }
    });

    it('should record transfer event in experience store', async () => {
      experienceLog = Array.from({ length: 20 }, () => makeEntry());
      const countBefore = experienceLog.length;
      await bootstrapNewAgent('inst-new', 'opstack');
      // Should have added a transfer event
      expect(experienceLog.length).toBe(countBefore + 1);
      const transferEntry = experienceLog[0]; // newest first
      expect(transferEntry.instanceId).toBe('inst-new');
      expect(transferEntry.trigger.type).toBe('bootstrap');
    });

    it('should not record transfer event when no patterns to transfer', async () => {
      const countBefore = experienceLog.length;
      await bootstrapNewAgent('inst-new', 'opstack');
      expect(experienceLog.length).toBe(countBefore);
    });
  });
});
