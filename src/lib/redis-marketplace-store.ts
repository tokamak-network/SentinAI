/**
 * Redis-backed Marketplace Store
 *
 * Provides concrete implementation of IMarketplaceStore for dynamic pricing
 * and bonus configuration management via Redis. Supports partial updates,
 * error recovery with defaults, and structured logging.
 */

import {
  IMarketplaceStore,
  DEFAULT_PRICING,
  DEFAULT_BONUS_CONFIG,
} from '@/lib/marketplace-store';
import type {
  MarketplacePricingConfig,
  PricingUpdateRequest,
  OutcomeBonusConfig,
} from '@/types/marketplace';
import { getStore } from '@/lib/redis-store';
import logger from '@/lib/logger';

/**
 * Redis-based implementation of IMarketplaceStore.
 * Persists pricing and bonus configurations to Redis with error handling
 * and fallback to hardcoded defaults.
 */
export class RedisMarketplaceStore implements IMarketplaceStore {
  /**
   * Retrieve current pricing configuration from Redis.
   * Falls back to DEFAULT_PRICING if retrieval fails.
   *
   * @returns Promise resolving to current MarketplacePricingConfig
   */
  async getPricingConfig(): Promise<MarketplacePricingConfig> {
    try {
      const state = getStore();
      return await state.getMarketplacePricingConfig(DEFAULT_PRICING);
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to get pricing config:',
        error instanceof Error ? error.message : String(error)
      );
      return DEFAULT_PRICING;
    }
  }

  /**
   * Update pricing configuration with partial overrides.
   * Merges provided tier prices with existing configuration,
   * preserving unspecified tiers at their current values.
   *
   * @param update - Partial pricing update containing optional tier prices
   * @returns Promise resolving to updated MarketplacePricingConfig
   */
  async updatePricing(
    update: PricingUpdateRequest
  ): Promise<MarketplacePricingConfig> {
    try {
      const state = getStore();
      const current = await state.getMarketplacePricingConfig(DEFAULT_PRICING);

      const updated: MarketplacePricingConfig = {
        traineePrice: update.traineePrice ?? current.traineePrice,
        juniorPrice: update.juniorPrice ?? current.juniorPrice,
        seniorPrice: update.seniorPrice ?? current.seniorPrice,
        expertPrice: update.expertPrice ?? current.expertPrice,
        updatedAt: new Date().toISOString(),
        updatedBy: current.updatedBy,
      };

      await state.setMarketplacePricingConfig(updated);

      logger.info('[Marketplace Store] Pricing updated:', {
        traineePrice: updated.traineePrice,
        juniorPrice: updated.juniorPrice,
        seniorPrice: updated.seniorPrice,
        expertPrice: updated.expertPrice,
        updatedAt: updated.updatedAt,
      });

      return updated;
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to update pricing:',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Reset pricing configuration to hardcoded defaults.
   * Useful for reverting to initial state or fixing corrupted data.
   *
   * @returns Promise resolving to default MarketplacePricingConfig
   */
  async resetPricingToDefaults(): Promise<MarketplacePricingConfig> {
    try {
      const state = getStore();
      const reset: MarketplacePricingConfig = {
        ...DEFAULT_PRICING,
        updatedAt: new Date().toISOString(),
      };

      await state.setMarketplacePricingConfig(reset);

      logger.info('[Marketplace Store] Pricing reset to defaults:', {
        updatedAt: reset.updatedAt,
      });

      return reset;
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to reset pricing:',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Retrieve current outcome bonus configuration from Redis.
   * Falls back to DEFAULT_BONUS_CONFIG if retrieval fails.
   *
   * @returns Promise resolving to current OutcomeBonusConfig
   */
  async getBonusConfig(): Promise<OutcomeBonusConfig> {
    try {
      const state = getStore();
      return await state.getMarketplaceBonusConfig(DEFAULT_BONUS_CONFIG);
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to get bonus config:',
        error instanceof Error ? error.message : String(error)
      );
      return DEFAULT_BONUS_CONFIG;
    }
  }

  /**
   * Update outcome bonus configuration with partial overrides.
   * Merges provided bonus settings with existing configuration,
   * preserving unspecified fields at their current values.
   *
   * @param update - Partial bonus configuration update
   * @returns Promise resolving to updated OutcomeBonusConfig
   */
  async updateBonusConfig(
    update: Partial<OutcomeBonusConfig>
  ): Promise<OutcomeBonusConfig> {
    try {
      const state = getStore();
      const current = await state.getMarketplaceBonusConfig(DEFAULT_BONUS_CONFIG);

      const updated: OutcomeBonusConfig = {
        autoResolveBonusPerIncident:
          update.autoResolveBonusPerIncident ??
          current.autoResolveBonusPerIncident,
        uptimeBonusThreshold:
          update.uptimeBonusThreshold ?? current.uptimeBonusThreshold,
        uptimeBonusAmount: update.uptimeBonusAmount ?? current.uptimeBonusAmount,
      };

      await state.setMarketplaceBonusConfig(updated);

      logger.info('[Marketplace Store] Bonus config updated:', {
        autoResolveBonusPerIncident: updated.autoResolveBonusPerIncident,
        uptimeBonusThreshold: updated.uptimeBonusThreshold,
        uptimeBonusAmount: updated.uptimeBonusAmount,
      });

      return updated;
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to update bonus config:',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
}
