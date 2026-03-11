/**
 * Integration Tests: Pricing Engine + Marketplace Store
 *
 * Verifies that pricing-engine loads pricing configuration from marketplace store
 * correctly and handles fallback scenarios.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { calculatePricing, calculateOutcomeBonuses } from '@/lib/pricing-engine';
import type { MarketplacePricingConfig, OutcomeBonusConfig } from '@/types/marketplace';

// Mock dependencies
vi.mock('@/lib/agent-resume');
vi.mock('@/lib/experience-store');
vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/trace-context', () => ({
  getTraceId: () => 'tr-test-integration',
}));
vi.mock('@/lib/marketplace-store', () => ({
  setMarketplaceStore: vi.fn(),
  getMarketplaceStore: vi.fn(),
  DEFAULT_PRICING: {
    traineePrice: 0,
    juniorPrice: 19900,
    seniorPrice: 49900,
    expertPrice: 79900,
    updatedAt: new Date().toISOString(),
  },
  DEFAULT_BONUS_CONFIG: {
    autoResolveBonusPerIncident: 100,
    uptimeBonusThreshold: 30,
    uptimeBonusAmount: 500,
  },
}));

import { generateResume } from '@/lib/agent-resume';
import { getExperienceByInstance } from '@/lib/experience-store';
import { getMarketplaceStore } from '@/lib/marketplace-store';

describe('Pricing Engine + Marketplace Store Integration', () => {
  const DEFAULT_PRICING: MarketplacePricingConfig = {
    traineePrice: 0,
    juniorPrice: 19900,
    seniorPrice: 49900,
    expertPrice: 79900,
    updatedAt: new Date().toISOString(),
  };

  const DEFAULT_BONUS_CONFIG: OutcomeBonusConfig = {
    autoResolveBonusPerIncident: 100,
    uptimeBonusThreshold: 30,
    uptimeBonusAmount: 500,
  };

  let mockMarketplaceStore: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock marketplace store
    mockMarketplaceStore = {
      getPricingConfig: vi.fn(),
      updatePricing: vi.fn(),
      resetPricingToDefaults: vi.fn(),
      getBonusConfig: vi.fn(),
      updateBonusConfig: vi.fn(),
    };

    // Mock getMarketplaceStore to return our mock store
    vi.mocked(getMarketplaceStore).mockReturnValue(mockMarketplaceStore);
  });


  // =========================================================================
  // Suite: Load Pricing from Marketplace Store
  // =========================================================================

  describe('calculatePricing with custom marketplace pricing', () => {
    it('should load pricing from marketplace store and use custom junior price', async () => {
      // Arrange
      const customPricing: MarketplacePricingConfig = {
        traineePrice: 0,
        juniorPrice: 25000, // $250 instead of default $199
        seniorPrice: 49900,
        expertPrice: 79900,
        updatedAt: new Date().toISOString(),
      };

      const mockResume = {
        agentId: 'agent-123',
        instanceId: 'inst-test',
        protocolId: 'opstack',
        tier: 'junior' as const,
        operationsCount: 150,
        successRate: 0.98,
        averageResolutionMs: 45000,
        cumulativeDays: 60,
        primaryChain: 'optimism',
      };

      (mockMarketplaceStore.getPricingConfig as any).mockResolvedValue(customPricing);
      (mockMarketplaceStore.getBonusConfig as any).mockResolvedValue(DEFAULT_BONUS_CONFIG);
      (generateResume as any).mockResolvedValue(mockResume);
      (getExperienceByInstance as any).mockResolvedValue([]);

      // Act
      const result = await calculatePricing('inst-test', 'opstack');

      // Assert
      expect(result.tier).toBe('junior');
      expect(result.monthlyRate).toBe(250); // $250 from custom pricing
      expect(mockMarketplaceStore.getPricingConfig).toHaveBeenCalled();
    });

    it('should load pricing from marketplace store and use custom senior price', async () => {
      // Arrange
      const customPricing: MarketplacePricingConfig = {
        traineePrice: 0,
        juniorPrice: 19900,
        seniorPrice: 55000, // $550 instead of default $499
        expertPrice: 79900,
        updatedAt: new Date().toISOString(),
      };

      const mockResume = {
        agentId: 'agent-456',
        instanceId: 'inst-test-2',
        protocolId: 'opstack',
        tier: 'senior' as const,
        operationsCount: 300,
        successRate: 0.99,
        averageResolutionMs: 35000,
        cumulativeDays: 120,
        primaryChain: 'optimism',
      };

      (mockMarketplaceStore.getPricingConfig as any).mockResolvedValue(customPricing);
      (mockMarketplaceStore.getBonusConfig as any).mockResolvedValue(DEFAULT_BONUS_CONFIG);
      (generateResume as any).mockResolvedValue(mockResume);
      (getExperienceByInstance as any).mockResolvedValue([]);

      // Act
      const result = await calculatePricing('inst-test-2', 'opstack');

      // Assert
      expect(result.tier).toBe('senior');
      expect(result.monthlyRate).toBe(550); // $550 from custom pricing
      expect(mockMarketplaceStore.getPricingConfig).toHaveBeenCalled();
    });

    it('should fall back to default pricing if marketplace store returns defaults', async () => {
      // Arrange
      const mockResume = {
        agentId: 'agent-789',
        instanceId: 'inst-test-3',
        protocolId: 'opstack',
        tier: 'junior' as const,
        operationsCount: 150,
        successRate: 0.98,
        averageResolutionMs: 45000,
        cumulativeDays: 60,
        primaryChain: 'optimism',
      };

      (mockMarketplaceStore.getPricingConfig as any).mockResolvedValue(DEFAULT_PRICING);
      (mockMarketplaceStore.getBonusConfig as any).mockResolvedValue(DEFAULT_BONUS_CONFIG);
      (generateResume as any).mockResolvedValue(mockResume);
      (getExperienceByInstance as any).mockResolvedValue([]);

      // Act
      const result = await calculatePricing('inst-test-3', 'opstack');

      // Assert
      expect(result.tier).toBe('junior');
      expect(result.monthlyRate).toBe(199); // Default price from DEFAULT_PRICING
      expect(mockMarketplaceStore.getPricingConfig).toHaveBeenCalled();
    });

    it('should fall back to TIER_PRICING if marketplace store throws error', async () => {
      // Arrange
      const mockResume = {
        agentId: 'agent-fail',
        instanceId: 'inst-test-fail',
        protocolId: 'opstack',
        tier: 'expert' as const,
        operationsCount: 500,
        successRate: 1.0,
        averageResolutionMs: 20000,
        cumulativeDays: 200,
        primaryChain: 'optimism',
      };

      (mockMarketplaceStore.getPricingConfig as any).mockRejectedValue(
        new Error('Redis connection failed')
      );
      (mockMarketplaceStore.getBonusConfig as any).mockResolvedValue(DEFAULT_BONUS_CONFIG);
      (generateResume as any).mockResolvedValue(mockResume);
      (getExperienceByInstance as any).mockResolvedValue([]);

      // Act
      const result = await calculatePricing('inst-test-fail', 'opstack');

      // Assert
      expect(result.tier).toBe('expert');
      expect(result.monthlyRate).toBe(799); // Fallback to TIER_PRICING constant
      expect(mockMarketplaceStore.getPricingConfig).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Suite: Load Bonus Configuration
  // =========================================================================

  describe('calculateOutcomeBonuses with custom marketplace bonus config', () => {
    it('should use custom auto-resolve bonus from marketplace store', async () => {
      // Arrange
      const customBonusConfig: OutcomeBonusConfig = {
        autoResolveBonusPerIncident: 15000, // $150 instead of default $1.00
        uptimeBonusThreshold: 30,
        uptimeBonusAmount: 500,
      };

      const entries = Array.from({ length: 2 }, () => ({
        outcome: 'success',
        category: 'anomaly-resolution',
        resolutionMs: 30000,
      }));

      (mockMarketplaceStore.getBonusConfig as any).mockResolvedValue(customBonusConfig);

      // Act
      const result = await calculateOutcomeBonuses(entries);

      // Assert
      const autoBonus = result.find((b) => b.type === 'auto-resolved');
      expect(autoBonus).toBeDefined();
      // 2 incidents × ($15000 / 100) = 2 × $150 = $300
      expect(autoBonus!.amount).toBe(300);
      expect(mockMarketplaceStore.getBonusConfig).toHaveBeenCalled();
    });

    it('should use custom uptime bonus threshold from marketplace store', async () => {
      // Arrange
      const customBonusConfig: OutcomeBonusConfig = {
        autoResolveBonusPerIncident: 100,
        uptimeBonusThreshold: 50, // 50 operations threshold instead of 30
        uptimeBonusAmount: 75000, // $750 instead of $5
      };

      // Create exactly 50 successful operations
      const entries = Array.from({ length: 50 }, (_, i) => ({
        outcome: 'success',
        category: `category-${i}`,
        resolutionMs: 20000,
      }));

      (mockMarketplaceStore.getBonusConfig as any).mockResolvedValue(customBonusConfig);

      // Act
      const result = await calculateOutcomeBonuses(entries);

      // Assert
      const uptimeBonus = result.find((b) => b.type === 'uptime-bonus');
      expect(uptimeBonus).toBeDefined();
      expect(uptimeBonus!.amount).toBe(750); // $750 from custom config (75000 / 100)
    });

    it('should not grant uptime bonus if operations below custom threshold', async () => {
      // Arrange
      const customBonusConfig: OutcomeBonusConfig = {
        autoResolveBonusPerIncident: 100,
        uptimeBonusThreshold: 50,
        uptimeBonusAmount: 75000,
      };

      // Create 49 operations (below 50 threshold)
      const entries = Array.from({ length: 49 }, (_, i) => ({
        outcome: 'success',
        category: `category-${i}`,
        resolutionMs: 20000,
      }));

      (mockMarketplaceStore.getBonusConfig as any).mockResolvedValue(customBonusConfig);

      // Act
      const result = await calculateOutcomeBonuses(entries);

      // Assert
      const uptimeBonus = result.find((b) => b.type === 'uptime-bonus');
      expect(uptimeBonus).toBeUndefined();
    });

    it('should fall back to default bonus config if marketplace store throws error', async () => {
      // Arrange
      const entries = Array.from({ length: 2 }, () => ({
        outcome: 'success',
        category: 'anomaly-resolution',
        resolutionMs: 30000,
      }));

      (mockMarketplaceStore.getBonusConfig as any).mockRejectedValue(
        new Error('Redis connection failed')
      );

      // Act
      const result = await calculateOutcomeBonuses(entries);

      // Assert
      const autoBonus = result.find((b) => b.type === 'auto-resolved');
      expect(autoBonus).toBeDefined();
      // 2 incidents × ($1.00) = $2.00
      expect(autoBonus!.amount).toBe(2);
      expect(mockMarketplaceStore.getBonusConfig).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Suite: Integration Scenario - Complete Pricing Calculation
  // =========================================================================

  describe('complete pricing calculation with custom config', () => {
    it('should use custom pricing tier and calculate correct monthly rate', async () => {
      // Arrange
      const customPricing: MarketplacePricingConfig = {
        traineePrice: 0,
        juniorPrice: 30000, // $300
        seniorPrice: 60000, // $600
        expertPrice: 90000, // $900
        updatedAt: new Date().toISOString(),
      };

      const customBonusConfig: OutcomeBonusConfig = {
        autoResolveBonusPerIncident: 20000, // $200 per incident
        uptimeBonusThreshold: 20,
        uptimeBonusAmount: 100000, // $1000
      };

      const mockResume = {
        agentId: 'agent-integration',
        instanceId: 'inst-integration',
        protocolId: 'opstack',
        tier: 'senior' as const,
        operationsCount: 25,
        successRate: 1.0,
        averageResolutionMs: 35000,
        cumulativeDays: 120,
        primaryChain: 'optimism',
      };

      // Current month entries: no entries to simplify test
      const monthEntries: any[] = [];

      (mockMarketplaceStore.getPricingConfig as any).mockResolvedValue(customPricing);
      (mockMarketplaceStore.getBonusConfig as any).mockResolvedValue(customBonusConfig);
      (generateResume as any).mockResolvedValue(mockResume);
      (getExperienceByInstance as any).mockResolvedValue(monthEntries);

      // Act
      const result = await calculatePricing('inst-integration', 'opstack');

      // Assert
      expect(result.tier).toBe('senior');
      expect(result.monthlyRate).toBe(600); // $600 from custom pricing (60000 cents / 100)
      expect(result.totalMonthlyValue).toBe(600); // Just the monthly rate with no bonuses
    });
  });

  // =========================================================================
  // Suite: Store Getter Validation
  // =========================================================================

  describe('marketplace store getter and setter', () => {
    it('should inject and retrieve mock store', () => {
      // The store was set in beforeEach
      const injectedStore = getMarketplaceStore();
      expect(injectedStore).toBeDefined();
      expect(injectedStore.getPricingConfig).toBeDefined();
      expect(injectedStore.getBonusConfig).toBeDefined();
    });

    it('should call marketplace store methods during pricing calculation', async () => {
      // Arrange
      const mockResume = {
        agentId: 'agent-call-test',
        instanceId: 'inst-call-test',
        protocolId: 'opstack',
        tier: 'junior' as const,
        operationsCount: 100,
        successRate: 0.95,
        averageResolutionMs: 40000,
        cumulativeDays: 50,
        primaryChain: 'optimism',
      };

      (mockMarketplaceStore.getPricingConfig as any).mockResolvedValue(DEFAULT_PRICING);
      (mockMarketplaceStore.getBonusConfig as any).mockResolvedValue(DEFAULT_BONUS_CONFIG);
      (generateResume as any).mockResolvedValue(mockResume);
      (getExperienceByInstance as any).mockResolvedValue([]);

      // Act
      await calculatePricing('inst-call-test', 'opstack');

      // Assert
      expect(mockMarketplaceStore.getPricingConfig).toHaveBeenCalledTimes(1);
      expect(mockMarketplaceStore.getBonusConfig).toHaveBeenCalledTimes(1);
    });
  });
});
