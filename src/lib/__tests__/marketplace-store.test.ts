/**
 * Unit tests for RedisMarketplaceStore
 * Tests pricing and bonus configuration management via mock state store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisMarketplaceStore } from '@/lib/redis-marketplace-store';
import { getStore } from '@/lib/redis-store';
import { DEFAULT_PRICING, DEFAULT_BONUS_CONFIG } from '@/lib/marketplace-store';
import type { MarketplacePricingConfig, OutcomeBonusConfig, PricingUpdateRequest } from '@/types/marketplace';

// Mock the redis-store module
vi.mock('@/lib/redis-store');

describe('RedisMarketplaceStore', () => {
  let store: RedisMarketplaceStore;
  let mockStateStore: ReturnType<typeof getStore>;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Create a fresh instance
    store = new RedisMarketplaceStore();

    // Setup mock state store
    mockStateStore = {
      getMarketplacePricingConfig: vi.fn(),
      setMarketplacePricingConfig: vi.fn(),
      getMarketplaceBonusConfig: vi.fn(),
      setMarketplaceBonusConfig: vi.fn(),
    } as any;

    // Mock getStore to return our mock state store
    vi.mocked(getStore).mockReturnValue(mockStateStore);
  });

  // =========================================================================
  // Suite: getPricingConfig
  // =========================================================================

  describe('getPricingConfig', () => {
    it('should return stored pricing config', async () => {
      // Arrange
      const customConfig: MarketplacePricingConfig = {
        traineePrice: 5000,
        juniorPrice: 25000,
        seniorPrice: 55000,
        expertPrice: 95000,
        updatedAt: '2026-03-11T10:00:00Z',
      };
      vi.mocked(mockStateStore.getMarketplacePricingConfig).mockResolvedValueOnce(customConfig);

      // Act
      const result = await store.getPricingConfig();

      // Assert
      expect(result).toEqual(customConfig);
      expect(mockStateStore.getMarketplacePricingConfig).toHaveBeenCalledWith(DEFAULT_PRICING);
    });

    it('should return default pricing if store is empty', async () => {
      // Arrange
      vi.mocked(mockStateStore.getMarketplacePricingConfig).mockResolvedValueOnce(DEFAULT_PRICING);

      // Act
      const result = await store.getPricingConfig();

      // Assert
      expect(result).toEqual(DEFAULT_PRICING);
    });

    it('should fallback to defaults on error', async () => {
      // Arrange
      const error = new Error('Redis connection failed');
      vi.mocked(mockStateStore.getMarketplacePricingConfig).mockRejectedValueOnce(error);

      // Act
      const result = await store.getPricingConfig();

      // Assert
      expect(result).toEqual(DEFAULT_PRICING);
    });
  });

  // =========================================================================
  // Suite: updatePricing
  // =========================================================================

  describe('updatePricing', () => {
    it('should update single tier price', async () => {
      // Arrange
      vi.mocked(mockStateStore.getMarketplacePricingConfig).mockResolvedValueOnce(DEFAULT_PRICING);
      vi.mocked(mockStateStore.setMarketplacePricingConfig).mockResolvedValueOnce(undefined);

      const update: PricingUpdateRequest = {
        juniorPrice: 25000,
      };

      // Act
      const result = await store.updatePricing(update);

      // Assert
      expect(result.juniorPrice).toBe(25000);
      expect(result.seniorPrice).toBe(DEFAULT_PRICING.seniorPrice);
      expect(result.traineePrice).toBe(DEFAULT_PRICING.traineePrice);
      expect(mockStateStore.setMarketplacePricingConfig).toHaveBeenCalled();
    });

    it('should update multiple tier prices', async () => {
      // Arrange
      vi.mocked(mockStateStore.getMarketplacePricingConfig).mockResolvedValueOnce(DEFAULT_PRICING);
      vi.mocked(mockStateStore.setMarketplacePricingConfig).mockResolvedValueOnce(undefined);

      const update: PricingUpdateRequest = {
        juniorPrice: 25000,
        seniorPrice: 55000,
      };

      // Act
      const result = await store.updatePricing(update);

      // Assert
      expect(result.juniorPrice).toBe(25000);
      expect(result.seniorPrice).toBe(55000);
      expect(result.traineePrice).toBe(DEFAULT_PRICING.traineePrice);
      expect(result.expertPrice).toBe(DEFAULT_PRICING.expertPrice);
    });

    it('should update updatedAt timestamp', async () => {
      // Arrange
      const before = new Date();
      vi.mocked(mockStateStore.getMarketplacePricingConfig).mockResolvedValueOnce(DEFAULT_PRICING);
      vi.mocked(mockStateStore.setMarketplacePricingConfig).mockResolvedValueOnce(undefined);

      // Act
      const result = await store.updatePricing({ juniorPrice: 25000 });

      // Assert
      const after = new Date();
      const updatedAt = new Date(result.updatedAt);
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should throw on store error', async () => {
      // Arrange
      vi.mocked(mockStateStore.getMarketplacePricingConfig).mockResolvedValueOnce(DEFAULT_PRICING);
      const error = new Error('Redis write failed');
      vi.mocked(mockStateStore.setMarketplacePricingConfig).mockRejectedValueOnce(error);

      // Act & Assert
      await expect(store.updatePricing({ juniorPrice: 25000 })).rejects.toThrow('Redis write failed');
    });
  });

  // =========================================================================
  // Suite: resetPricingToDefaults
  // =========================================================================

  describe('resetPricingToDefaults', () => {
    it('should reset to DEFAULT_PRICING', async () => {
      // Arrange
      const customConfig: MarketplacePricingConfig = {
        traineePrice: 5000,
        juniorPrice: 25000,
        seniorPrice: 55000,
        expertPrice: 95000,
        updatedAt: '2026-01-01T00:00:00Z',
      };
      vi.mocked(mockStateStore.getMarketplacePricingConfig).mockResolvedValueOnce(customConfig);
      vi.mocked(mockStateStore.setMarketplacePricingConfig).mockResolvedValueOnce(undefined);

      // Act
      const result = await store.resetPricingToDefaults();

      // Assert
      expect(result.traineePrice).toBe(DEFAULT_PRICING.traineePrice);
      expect(result.juniorPrice).toBe(DEFAULT_PRICING.juniorPrice);
      expect(result.seniorPrice).toBe(DEFAULT_PRICING.seniorPrice);
      expect(result.expertPrice).toBe(DEFAULT_PRICING.expertPrice);
    });

    it('should update timestamp on reset', async () => {
      // Arrange
      const before = new Date();
      vi.mocked(mockStateStore.setMarketplacePricingConfig).mockResolvedValueOnce(undefined);

      // Act
      const result = await store.resetPricingToDefaults();

      // Assert
      const after = new Date();
      const updatedAt = new Date(result.updatedAt);
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should throw on store error during reset', async () => {
      // Arrange
      const error = new Error('Redis write failed');
      vi.mocked(mockStateStore.setMarketplacePricingConfig).mockRejectedValueOnce(error);

      // Act & Assert
      await expect(store.resetPricingToDefaults()).rejects.toThrow('Redis write failed');
    });
  });

  // =========================================================================
  // Suite: getBonusConfig
  // =========================================================================

  describe('getBonusConfig', () => {
    it('should return stored bonus config', async () => {
      // Arrange
      const customBonusConfig: OutcomeBonusConfig = {
        autoResolveBonusPerIncident: 15000,
        uptimeBonusThreshold: 50,
        uptimeBonusAmount: 75000,
      };
      vi.mocked(mockStateStore.getMarketplaceBonusConfig).mockResolvedValueOnce(customBonusConfig);

      // Act
      const result = await store.getBonusConfig();

      // Assert
      expect(result).toEqual(customBonusConfig);
      expect(mockStateStore.getMarketplaceBonusConfig).toHaveBeenCalledWith(DEFAULT_BONUS_CONFIG);
    });

    it('should return defaults if not stored', async () => {
      // Arrange
      vi.mocked(mockStateStore.getMarketplaceBonusConfig).mockResolvedValueOnce(DEFAULT_BONUS_CONFIG);

      // Act
      const result = await store.getBonusConfig();

      // Assert
      expect(result).toEqual(DEFAULT_BONUS_CONFIG);
    });

    it('should fallback to defaults on error', async () => {
      // Arrange
      const error = new Error('Redis connection failed');
      vi.mocked(mockStateStore.getMarketplaceBonusConfig).mockRejectedValueOnce(error);

      // Act
      const result = await store.getBonusConfig();

      // Assert
      expect(result).toEqual(DEFAULT_BONUS_CONFIG);
    });
  });

  // =========================================================================
  // Suite: updateBonusConfig
  // =========================================================================

  describe('updateBonusConfig', () => {
    it('should update partial bonus config', async () => {
      // Arrange
      vi.mocked(mockStateStore.getMarketplaceBonusConfig).mockResolvedValueOnce(DEFAULT_BONUS_CONFIG);
      vi.mocked(mockStateStore.setMarketplaceBonusConfig).mockResolvedValueOnce(undefined);

      // Act
      const result = await store.updateBonusConfig({
        autoResolveBonusPerIncident: 15000,
      });

      // Assert
      expect(result.autoResolveBonusPerIncident).toBe(15000);
      expect(result.uptimeBonusThreshold).toBe(DEFAULT_BONUS_CONFIG.uptimeBonusThreshold);
      expect(result.uptimeBonusAmount).toBe(DEFAULT_BONUS_CONFIG.uptimeBonusAmount);
    });

    it('should update multiple bonus fields', async () => {
      // Arrange
      vi.mocked(mockStateStore.getMarketplaceBonusConfig).mockResolvedValueOnce(DEFAULT_BONUS_CONFIG);
      vi.mocked(mockStateStore.setMarketplaceBonusConfig).mockResolvedValueOnce(undefined);

      // Act
      const result = await store.updateBonusConfig({
        autoResolveBonusPerIncident: 15000,
        uptimeBonusThreshold: 50,
      });

      // Assert
      expect(result.autoResolveBonusPerIncident).toBe(15000);
      expect(result.uptimeBonusThreshold).toBe(50);
      expect(result.uptimeBonusAmount).toBe(DEFAULT_BONUS_CONFIG.uptimeBonusAmount);
    });

    it('should update all bonus config fields', async () => {
      // Arrange
      vi.mocked(mockStateStore.getMarketplaceBonusConfig).mockResolvedValueOnce(DEFAULT_BONUS_CONFIG);
      vi.mocked(mockStateStore.setMarketplaceBonusConfig).mockResolvedValueOnce(undefined);

      // Act
      const result = await store.updateBonusConfig({
        autoResolveBonusPerIncident: 15000,
        uptimeBonusThreshold: 50,
        uptimeBonusAmount: 75000,
      });

      // Assert
      expect(result.autoResolveBonusPerIncident).toBe(15000);
      expect(result.uptimeBonusThreshold).toBe(50);
      expect(result.uptimeBonusAmount).toBe(75000);
    });

    it('should throw on store error', async () => {
      // Arrange
      vi.mocked(mockStateStore.getMarketplaceBonusConfig).mockResolvedValueOnce(DEFAULT_BONUS_CONFIG);
      const error = new Error('Redis write failed');
      vi.mocked(mockStateStore.setMarketplaceBonusConfig).mockRejectedValueOnce(error);

      // Act & Assert
      await expect(
        store.updateBonusConfig({
          autoResolveBonusPerIncident: 15000,
        })
      ).rejects.toThrow('Redis write failed');
    });
  });
});
