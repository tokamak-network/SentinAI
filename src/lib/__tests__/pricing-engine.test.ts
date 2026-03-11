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
    incrementLifetimeStats: async () => {},
    getLifetimeStats: async () => null,
  }),
}));

vi.mock('@/lib/trace-context', () => ({
  getTraceId: () => 'tr-test-pricing',
}));

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/marketplace-store', () => ({
  getMarketplaceStore: () => ({
    getPricingConfig: async () => ({
      traineePrice: 0,
      juniorPrice: 19900,
      seniorPrice: 49900,
      expertPrice: 79900,
      updatedAt: new Date().toISOString(),
    }),
    getBonusConfig: async () => ({
      autoResolveBonusPerIncident: 100,
      uptimeBonusThreshold: 30,
      uptimeBonusAmount: 500,
    }),
  }),
}));

import { calculatePricing, calculateOutcomeBonuses, TIER_PRICING } from '@/lib/pricing-engine';

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

describe('pricing-engine', () => {
  beforeEach(() => {
    experienceLog = [];
  });

  describe('TIER_PRICING', () => {
    it('should have correct pricing for each tier', () => {
      expect(TIER_PRICING.trainee).toBe(0);
      expect(TIER_PRICING.junior).toBe(199);
      expect(TIER_PRICING.senior).toBe(499);
      expect(TIER_PRICING.expert).toBe(799);
    });
  });

  describe('calculateOutcomeBonuses', () => {
    it('should return empty array for no entries', async () => {
      const result = await calculateOutcomeBonuses([]);
      expect(result).toEqual([]);
    });

    it('should calculate auto-resolved bonus', async () => {
      const entries = Array.from({ length: 3 }, () => ({
        outcome: 'success',
        category: 'anomaly-resolution',
        resolutionMs: 30000,
      }));
      const result = await calculateOutcomeBonuses(entries);
      const autoBonus = result.find(b => b.type === 'auto-resolved');
      expect(autoBonus).toBeDefined();
      expect(autoBonus!.amount).toBe(3); // 3 × $1.00 (100 cents / 100)
    });

    it('should not count non-anomaly successes as auto-resolved', async () => {
      const entries = Array.from({ length: 5 }, () => ({
        outcome: 'success',
        category: 'scaling-action',
        resolutionMs: 30000,
      }));
      const result = await calculateOutcomeBonuses(entries);
      const autoBonus = result.find(b => b.type === 'auto-resolved');
      expect(autoBonus).toBeUndefined();
    });

    it('should award uptime bonus for 30+ ops with zero failures', async () => {
      const entries = Array.from({ length: 30 }, () => ({
        outcome: 'success',
        category: 'scaling-action',
        resolutionMs: 30000,
      }));
      const result = await calculateOutcomeBonuses(entries);
      const uptimeBonus = result.find(b => b.type === 'uptime-bonus');
      expect(uptimeBonus).toBeDefined();
      expect(uptimeBonus!.amount).toBe(5); // $5.00 (500 cents / 100)
    });

    it('should not award uptime bonus when failures exist', async () => {
      const entries = [
        ...Array.from({ length: 29 }, () => ({
          outcome: 'success',
          category: 'scaling-action',
          resolutionMs: 30000,
        })),
        { outcome: 'failure', category: 'scaling-action', resolutionMs: 30000 },
      ];
      const result = await calculateOutcomeBonuses(entries);
      const uptimeBonus = result.find(b => b.type === 'uptime-bonus');
      expect(uptimeBonus).toBeUndefined();
    });

    it('should not award uptime bonus for fewer than 30 ops', async () => {
      const entries = Array.from({ length: 10 }, () => ({
        outcome: 'success',
        category: 'scaling-action',
        resolutionMs: 30000,
      }));
      const result = await calculateOutcomeBonuses(entries);
      const uptimeBonus = result.find(b => b.type === 'uptime-bonus');
      expect(uptimeBonus).toBeUndefined();
    });
  });

  describe('calculatePricing', () => {
    it('should return trainee tier with $0 rate for new agent', async () => {
      const result = await calculatePricing('inst-1', 'opstack');
      expect(result.tier).toBe('trainee');
      expect(result.monthlyRate).toBe(0);
      expect(result.instanceId).toBe('inst-1');
    });

    it('should include outcome bonuses in total value', async () => {
      // Create entries this month with anomaly resolutions
      experienceLog = Array.from({ length: 5 }, () =>
        makeEntry({
          instanceId: 'inst-1',
          category: 'anomaly-resolution',
          outcome: 'success',
        }),
      );
      const result = await calculatePricing('inst-1', 'opstack');
      expect(result.outcomeBonuses.length).toBeGreaterThan(0);
      expect(result.totalMonthlyValue).toBe(
        result.monthlyRate + result.outcomeBonuses.reduce((s, b) => s + b.amount, 0),
      );
    });

    it('should calculate correct tier based on operating days', async () => {
      // Create entries spanning 100 days → senior tier
      const now = Date.now();
      experienceLog = [
        makeEntry({
          instanceId: 'inst-1',
          timestamp: new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        makeEntry({
          instanceId: 'inst-1',
          timestamp: new Date(now).toISOString(),
        }),
      ];
      const result = await calculatePricing('inst-1', 'opstack');
      expect(result.tier).toBe('senior');
      expect(result.monthlyRate).toBe(499);
    });
  });
});
