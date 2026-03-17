/**
 * Tests for Ops Score Calculator
 *
 * Tests score calculation, bracket matching, and edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { calculateOpsScore, resolveBracket } from '@/lib/ops-score-calculator';
import type { PricingBracket } from '@/types/marketplace';

// Mock dependencies
vi.mock('@/lib/experience-store');
vi.mock('@/lib/agent-marketplace/reputation-state-store');
vi.mock('@/lib/agent-marketplace/sla-tracker');
vi.mock('@/lib/agent-resume');
vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/trace-context', () => ({
  getTraceId: () => 'tr-test',
}));

import { getLifetimeStats } from '@/lib/experience-store';
import { getAgentMarketplaceReputationScores } from '@/lib/agent-marketplace/reputation-state-store';
import { summarizeAgentMarketplaceSla } from '@/lib/agent-marketplace/sla-tracker';
import { generateResume } from '@/lib/agent-resume';

describe('Ops Score Calculator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Suite: resolveBracket (pure function)
  // =========================================================================

  describe('resolveBracket', () => {
    const defaultBrackets: PricingBracket[] = [
      { floor: 80, priceCents: 79900, label: 'Expert' },
      { floor: 60, priceCents: 49900, label: 'Advanced' },
      { floor: 30, priceCents: 19900, label: 'Standard' },
      { floor: 0, priceCents: 0, label: 'Starter' },
    ];

    it('should return Expert bracket for score 90', () => {
      const result = resolveBracket(90, defaultBrackets);
      expect(result.label).toBe('Expert');
      expect(result.priceCents).toBe(79900);
    });

    it('should return Expert bracket for score exactly 80', () => {
      const result = resolveBracket(80, defaultBrackets);
      expect(result.label).toBe('Expert');
    });

    it('should return Advanced bracket for score 70', () => {
      const result = resolveBracket(70, defaultBrackets);
      expect(result.label).toBe('Advanced');
    });

    it('should return Standard bracket for score 45', () => {
      const result = resolveBracket(45, defaultBrackets);
      expect(result.label).toBe('Standard');
    });

    it('should return Starter bracket for score 0', () => {
      const result = resolveBracket(0, defaultBrackets);
      expect(result.label).toBe('Starter');
      expect(result.priceCents).toBe(0);
    });

    it('should return Starter bracket for score 29', () => {
      const result = resolveBracket(29, defaultBrackets);
      expect(result.label).toBe('Starter');
    });

    it('should return Expert bracket for score 100', () => {
      const result = resolveBracket(100, defaultBrackets);
      expect(result.label).toBe('Expert');
    });

    it('should handle unsorted brackets', () => {
      const unsorted: PricingBracket[] = [
        { floor: 0, priceCents: 0, label: 'Starter' },
        { floor: 80, priceCents: 79900, label: 'Expert' },
        { floor: 30, priceCents: 19900, label: 'Standard' },
      ];
      const result = resolveBracket(85, unsorted);
      expect(result.label).toBe('Expert');
    });

    it('should fallback for empty brackets', () => {
      const result = resolveBracket(50, []);
      expect(result.label).toBe('Starter');
      expect(result.priceCents).toBe(0);
    });
  });

  // =========================================================================
  // Suite: calculateOpsScore
  // =========================================================================

  describe('calculateOpsScore', () => {
    it('should calculate score with all data sources available', async () => {
      // Mock SLA
      vi.mocked(summarizeAgentMarketplaceSla).mockResolvedValue({
        fromIso: '',
        toIso: '',
        agents: [
          { agentId: 'inst-1', totalRequests: 100, successRate: 0.99, averageLatencyMs: 500, scoreDelta: 5, newScore: 85 },
        ],
      });

      // Mock Reputation
      vi.mocked(getAgentMarketplaceReputationScores).mockResolvedValue({
        'inst-1': 90,
      });

      // Mock Lifetime Stats
      vi.mocked(getLifetimeStats).mockResolvedValue({
        totalOps: 200,
        successCount: 190,
        failureCount: 10,
        partialCount: 0,
        totalResolutionMs: 6000000, // avg 30000ms
        firstSeenAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        lastSeenAt: new Date().toISOString(),
        categories: { scaling: 100, security: 50 },
      });

      // Mock Resume with domain stats
      vi.mocked(generateResume).mockResolvedValue({
        instanceId: 'inst-1',
        protocolId: 'opstack',
        tier: 'senior',
        operatingSince: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        stats: {} as any,
        topPatterns: [],
        specialties: [],
        domainStats: {
          scaling: { operations: 100, successRate: 0.95 },
          security: { alertsDetected: 10, falsePositiveRate: 0.1 },
          reliability: { failoversExecuted: 5, uptimePercent: 99.9 },
          rca: { diagnosesRun: 0, accuracyRate: 0 },
          cost: { savingsIdentified: 0, savingsExecuted: 0 },
        },
        generatedAt: new Date().toISOString(),
      });

      const { opsScore, breakdown } = await calculateOpsScore('inst-1', 'opstack');

      // Verify score is within range
      expect(opsScore).toBeGreaterThanOrEqual(0);
      expect(opsScore).toBeLessThanOrEqual(100);

      // Verify breakdown
      expect(breakdown.slaScore).toBe(85);
      expect(breakdown.reputationScore).toBe(90);
      expect(breakdown.successRate).toBeCloseTo(0.95, 1);
      expect(breakdown.totalOperations).toBe(200);
      expect(breakdown.domainCoverage).toBe(3); // scaling, security, reliability have activity
    });

    it('should handle missing data sources gracefully', async () => {
      vi.mocked(summarizeAgentMarketplaceSla).mockRejectedValue(new Error('unavailable'));
      vi.mocked(getAgentMarketplaceReputationScores).mockRejectedValue(new Error('unavailable'));
      vi.mocked(getLifetimeStats).mockResolvedValue(null);
      vi.mocked(generateResume).mockResolvedValue(null as any);

      const { opsScore, breakdown } = await calculateOpsScore('inst-missing', 'opstack');

      expect(opsScore).toBeGreaterThanOrEqual(0);
      expect(opsScore).toBeLessThanOrEqual(100);
      expect(breakdown.slaScore).toBe(50); // default
      expect(breakdown.reputationScore).toBe(50); // default
      expect(breakdown.successRate).toBe(0);
      expect(breakdown.domainCoverage).toBe(0);
    });

    it('should clamp score between 0 and 100', async () => {
      vi.mocked(summarizeAgentMarketplaceSla).mockResolvedValue({
        fromIso: '',
        toIso: '',
        agents: [
          { agentId: 'inst-max', totalRequests: 1000, successRate: 1.0, averageLatencyMs: 100, scoreDelta: 0, newScore: 100 },
        ],
      });
      vi.mocked(getAgentMarketplaceReputationScores).mockResolvedValue({ 'inst-max': 100 });
      vi.mocked(getLifetimeStats).mockResolvedValue({
        totalOps: 10000,
        successCount: 10000,
        failureCount: 0,
        partialCount: 0,
        totalResolutionMs: 1000, // very fast
        firstSeenAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
        lastSeenAt: new Date().toISOString(),
        categories: {},
      });
      vi.mocked(generateResume).mockResolvedValue({
        instanceId: 'inst-max',
        protocolId: 'opstack',
        tier: 'expert',
        operatingSince: '',
        stats: {} as any,
        topPatterns: [],
        specialties: [],
        domainStats: {
          scaling: { operations: 100, successRate: 1.0 },
          security: { alertsDetected: 50, falsePositiveRate: 0 },
          reliability: { failoversExecuted: 20, uptimePercent: 100 },
          rca: { diagnosesRun: 30, accuracyRate: 1.0 },
          cost: { savingsIdentified: 10, savingsExecuted: 10 },
        },
        generatedAt: new Date().toISOString(),
      });

      const { opsScore } = await calculateOpsScore('inst-max', 'opstack');
      expect(opsScore).toBeLessThanOrEqual(100);
      expect(opsScore).toBeGreaterThanOrEqual(0);
    });
  });
});
