/**
 * Unit tests for cost-optimizer module
 * Tests AWS Fargate cost calculations and AI-powered optimization recommendations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as costOptimizer from '@/lib/cost-optimizer';
import { FARGATE_PRICING, TIME_CONSTANTS } from '@/types/cost';
import type { CostRecommendation } from '@/types/cost';

// Mock dependencies
vi.mock('@/lib/ai-client', () => ({
  chatCompletion: vi.fn(),
}));

vi.mock('@/lib/ai-response-parser', () => ({
  parseAIJSON: (content: string) => JSON.parse(content),
}));

vi.mock('@/lib/usage-tracker', () => ({
  analyzePatterns: vi.fn(),
  getUsageSummary: vi.fn(),
}));

vi.mock('@/lib/k8s-scaler', () => ({
  getScalingHistory: vi.fn(),
}));

describe('cost-optimizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateMonthlyCost', () => {
    it('should calculate monthly cost for 1 vCPU', () => {
      // 1 vCPU = 2 GiB memory
      // Hourly: 1 * 0.04656 + 2 * 0.00511 = 0.04656 + 0.01022 = 0.05678
      // Monthly (730 hours): 0.05678 * 730 ≈ 41.45
      const cost = costOptimizer.calculateMonthlyCost(1);

      expect(cost).toBeGreaterThan(40);
      expect(cost).toBeLessThan(45);
    });

    it('should calculate monthly cost for 2 vCPU', () => {
      // 2 vCPU = 4 GiB memory
      // Hourly: 2 * 0.04656 + 4 * 0.00511 = 0.09312 + 0.02044 = 0.11356
      // Monthly: 0.11356 * 730 ≈ 82.9
      const cost = costOptimizer.calculateMonthlyCost(2);

      expect(cost).toBeGreaterThan(80);
      expect(cost).toBeLessThan(85);
    });

    it('should calculate monthly cost for 4 vCPU (baseline)', () => {
      // 4 vCPU = 8 GiB memory
      // Hourly: 4 * 0.04656 + 8 * 0.00511 = 0.18624 + 0.04088 = 0.22712
      // Monthly: 0.22712 * 730 ≈ 165.8
      const cost = costOptimizer.calculateMonthlyCost(4);

      expect(cost).toBeGreaterThan(160);
      expect(cost).toBeLessThan(170);
    });

    it('should scale linearly with vCPU', () => {
      const cost1 = costOptimizer.calculateMonthlyCost(1);
      const cost2 = costOptimizer.calculateMonthlyCost(2);
      const cost4 = costOptimizer.calculateMonthlyCost(4);

      // Doubling vCPU should roughly double cost
      expect(cost2).toBeGreaterThan(cost1 * 1.9);
      expect(cost2).toBeLessThan(cost1 * 2.1);

      expect(cost4).toBeGreaterThan(cost2 * 1.9);
      expect(cost4).toBeLessThan(cost2 * 2.1);
    });

    it('should handle fractional vCPU values', () => {
      const cost1 = costOptimizer.calculateMonthlyCost(1.5);
      const cost1Half = costOptimizer.calculateMonthlyCost(1);
      const cost2 = costOptimizer.calculateMonthlyCost(2);

      // 1.5 should be between 1 and 2
      expect(cost1).toBeGreaterThan(cost1Half);
      expect(cost1).toBeLessThan(cost2);
    });

    it('should round to 2 decimal places (cents)', () => {
      const cost = costOptimizer.calculateMonthlyCost(2.5);

      // Should be rounded to cents
      expect(cost.toString().split('.')[1]?.length).toBeLessThanOrEqual(2);
    });

    it('should return 0 cost for 0 vCPU', () => {
      const cost = costOptimizer.calculateMonthlyCost(0);

      expect(cost).toBe(0);
    });
  });

  describe('getBaselineMonthlyCost', () => {
    it('should return cost for fixed 4 vCPU', () => {
      const baseline = costOptimizer.getBaselineMonthlyCost();
      const fourVcpu = costOptimizer.calculateMonthlyCost(4);

      expect(baseline).toBe(fourVcpu);
    });

    it('should return consistent value', () => {
      const baseline1 = costOptimizer.getBaselineMonthlyCost();
      const baseline2 = costOptimizer.getBaselineMonthlyCost();

      expect(baseline1).toBe(baseline2);
    });

    it('should be approximately $166/month', () => {
      const baseline = costOptimizer.getBaselineMonthlyCost();

      // AWS Fargate Seoul: 4 vCPU (8 GiB) ≈ $166/month
      expect(baseline).toBeGreaterThan(160);
      expect(baseline).toBeLessThan(170);
    });
  });

  describe('calculateProjectedCost', () => {
    it('should return baseline when no recommendations', () => {
      const baseline = costOptimizer.getBaselineMonthlyCost();
      const projected = costOptimizer.calculateProjectedCost([]);

      expect(projected).toBe(baseline);
    });

    it('should return lowest projected cost with single recommendation', () => {
      const recommendations: CostRecommendation[] = [
        {
          type: 'downscale',
          title: 'Reduce peak vCPU',
          description: 'Currently peaks at 4, can safely use 2',
          estimatedSavings: 50,
          projectedCost: 82,
          riskLevel: 'low',
          implementationSteps: ['Adjust max vCPU'],
          riskAssessment: 'No risk',
        },
      ];

      const projected = costOptimizer.calculateProjectedCost(recommendations);

      expect(projected).toBe(82);
    });

    it('should return minimum cost with multiple recommendations', () => {
      const recommendations: CostRecommendation[] = [
        {
          type: 'downscale',
          title: 'Rec 1',
          description: 'First option',
          estimatedSavings: 30,
          projectedCost: 135,
          riskLevel: 'low',
          implementationSteps: [],
          riskAssessment: 'Safe',
        },
        {
          type: 'schedule',
          title: 'Rec 2',
          description: 'Second option',
          estimatedSavings: 60,
          projectedCost: 105,
          riskLevel: 'medium',
          implementationSteps: [],
          riskAssessment: 'Moderate',
        },
      ];

      const projected = costOptimizer.calculateProjectedCost(recommendations);

      // Should return the lowest projected cost (105)
      expect(projected).toBe(105);
    });

    it('should handle very low projected costs', () => {
      const recommendations: CostRecommendation[] = [
        {
          type: 'reserved',
          title: 'Reserved capacity',
          description: 'Use reserved instances',
          estimatedSavings: 120,
          projectedCost: 46, // 1 vCPU optimized
          riskLevel: 'low',
          implementationSteps: [],
          riskAssessment: 'No risk',
        },
      ];

      const projected = costOptimizer.calculateProjectedCost(recommendations);

      expect(projected).toBe(46);
      expect(projected).toBeLessThan(costOptimizer.getBaselineMonthlyCost());
    });
  });

  describe('Integration: Cost Calculation Pipeline', () => {
    it('should show cost reduction from 4 vCPU to 1 vCPU', () => {
      const cost4 = costOptimizer.calculateMonthlyCost(4);
      const cost1 = costOptimizer.calculateMonthlyCost(1);

      const savings = cost4 - cost1;

      expect(savings).toBeGreaterThan(100);
      expect(savings).toBeLessThan(140);
    });

    it('should show savings percentage calculation', () => {
      const baseline = costOptimizer.getBaselineMonthlyCost();
      const optimized = costOptimizer.calculateMonthlyCost(2);

      const savingsPercentage = ((baseline - optimized) / baseline) * 100;

      // Dropping from 4 vCPU to 2 vCPU should save ~50%
      expect(savingsPercentage).toBeGreaterThan(45);
      expect(savingsPercentage).toBeLessThan(55);
    });

    it('should handle real-world recommendation scenario', () => {
      // Scenario: Currently using 4 vCPU fixed, can optimize to average 2 vCPU
      const currentCost = costOptimizer.calculateMonthlyCost(4);
      const optimizedCost = costOptimizer.calculateMonthlyCost(2);

      const recommendations: CostRecommendation[] = [
        {
          type: 'downscale',
          title: '평균 2 vCPU로 다운스케일',
          description: '평균 사용량이 2 vCPU 수준',
          estimatedSavings: Math.round(currentCost - optimizedCost),
          projectedCost: optimizedCost,
          riskLevel: 'low',
          implementationSteps: [
            'Max vCPU 2로 설정',
            '일일 모니터링 진행',
          ],
          riskAssessment: '위험 없음',
        },
      ];

      const projected = costOptimizer.calculateProjectedCost(recommendations);

      expect(projected).toBe(optimizedCost);
      expect(recommendations[0].estimatedSavings).toBeGreaterThan(70);
      expect(recommendations[0].estimatedSavings).toBeLessThan(90);
    });
  });

  describe('Cost Model Validation', () => {
    it('should use correct Fargate pricing constants', () => {
      // Verify pricing matches Seoul region
      expect(FARGATE_PRICING.vcpuPerHour).toBe(0.04656);
      expect(FARGATE_PRICING.memGbPerHour).toBe(0.00511);
    });

    it('should use correct time constants (730 hours/month)', () => {
      expect(TIME_CONSTANTS.HOURS_PER_MONTH).toBe(730);
    });

    it('should calculate memory as vCPU * 2 GiB', () => {
      // Verify memory calculation in monthly cost
      // Cost = (vCPU * vcpuPerHour + (vCPU * 2) * memGbPerHour) * hoursPerMonth
      const cost = costOptimizer.calculateMonthlyCost(2);

      // Manual calculation:
      // hourly = 2 * 0.04656 + 4 * 0.00511 = 0.11356
      // monthly = 0.11356 * 730 = 82.8988
      // rounded = 82.90
      expect(cost).toBeCloseTo(82.90, 1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small vCPU values', () => {
      const cost = costOptimizer.calculateMonthlyCost(0.5);

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(30);
    });

    it('should handle large vCPU values', () => {
      const cost = costOptimizer.calculateMonthlyCost(8);

      expect(cost).toBeGreaterThan(300);
      expect(cost).toBeLessThan(400);
    });

    it('should maintain consistency across multiple calls', () => {
      const costs = Array.from({ length: 5 }, () =>
        costOptimizer.calculateMonthlyCost(3)
      );

      // All calls should return identical values
      expect(new Set(costs).size).toBe(1);
    });
  });
});
