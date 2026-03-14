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
  CatalogAgent,
  MarketplaceOrder,
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

  /**
   * Retrieve all catalog agents from Redis.
   * Falls back to empty array if retrieval fails.
   *
   * @returns Promise resolving to array of CatalogAgent
   */
  async getCatalogAgents(): Promise<CatalogAgent[]> {
    try {
      const state = getStore();
      const agents = await state.getMarketplaceCatalogAgents([]);
      return agents;
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to get catalog agents:',
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  /**
   * Create a new catalog agent in Redis.
   *
   * @param agent - CatalogAgent without id
   * @returns Promise resolving to created CatalogAgent with id
   */
  async createCatalogAgent(
    agent: Omit<CatalogAgent, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<CatalogAgent> {
    try {
      const state = getStore();
      const id = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = Date.now();

      const newAgent: CatalogAgent = {
        id,
        ...agent,
        createdAt: now,
        updatedAt: now,
      };

      const agents = await state.getMarketplaceCatalogAgents([]);
      agents.push(newAgent);
      await state.setMarketplaceCatalogAgents(agents);

      logger.info('[Marketplace Store] Catalog agent created:', {
        id: newAgent.id,
        name: newAgent.name,
      });

      return newAgent;
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to create catalog agent:',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Update an existing catalog agent in Redis.
   *
   * @param id - Agent ID
   * @param updates - Partial agent updates
   * @returns Promise resolving to updated CatalogAgent
   */
  async updateCatalogAgent(
    id: string,
    updates: Partial<Omit<CatalogAgent, 'id' | 'createdAt'>>
  ): Promise<CatalogAgent> {
    try {
      const state = getStore();
      const agents = await state.getMarketplaceCatalogAgents([]);

      const agentIndex = agents.findIndex(a => a.id === id);
      if (agentIndex === -1) {
        throw new Error(`Agent not found: ${id}`);
      }

      const updated: CatalogAgent = {
        ...agents[agentIndex],
        ...updates,
        updatedAt: Date.now(),
      };

      agents[agentIndex] = updated;
      await state.setMarketplaceCatalogAgents(agents);

      logger.info('[Marketplace Store] Catalog agent updated:', {
        id: updated.id,
        name: updated.name,
      });

      return updated;
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to update catalog agent:',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Delete a catalog agent from Redis.
   *
   * @param id - Agent ID
   * @returns Promise resolving to deleted CatalogAgent
   */
  async deleteCatalogAgent(id: string): Promise<CatalogAgent> {
    try {
      const state = getStore();
      const agents = await state.getMarketplaceCatalogAgents([]);

      const agentIndex = agents.findIndex(a => a.id === id);
      if (agentIndex === -1) {
        throw new Error(`Agent not found: ${id}`);
      }

      const deleted = agents[agentIndex];
      agents.splice(agentIndex, 1);
      await state.setMarketplaceCatalogAgents(agents);

      logger.info('[Marketplace Store] Catalog agent deleted:', {
        id: deleted.id,
        name: deleted.name,
      });

      return deleted;
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to delete catalog agent:',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Retrieve paginated list of orders.
   *
   * @param page - Page number (1-indexed)
   * @param limit - Items per page
   * @returns Promise resolving to array of MarketplaceOrder
   */
  async getOrders(page: number, limit: number): Promise<MarketplaceOrder[]> {
    try {
      const state = getStore();
      const allOrders = await state.getMarketplaceOrders([]);

      const start = (page - 1) * limit;
      const end = start + limit;
      return allOrders.slice(start, end);
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to get orders:',
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  /**
   * Create a new order.
   *
   * @param order - MarketplaceOrder without id
   * @returns Promise resolving to created MarketplaceOrder with id
   */
  async createOrder(
    order: Omit<MarketplaceOrder, 'id'>
  ): Promise<MarketplaceOrder> {
    try {
      const state = getStore();
      const id = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const newOrder: MarketplaceOrder = {
        id,
        ...order,
      };

      const allOrders = await state.getMarketplaceOrders([]);
      allOrders.push(newOrder);
      await state.setMarketplaceOrders(allOrders);

      logger.info('[Marketplace Store] Order created:', {
        id: newOrder.id,
        agentId: newOrder.agentId,
      });

      return newOrder;
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to create order:',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Get orders summary.
   *
   * @returns Promise resolving to { totalCount, totalRevenueInCents }
   */
  async getOrdersSummary(): Promise<{ totalCount: number; totalRevenueInCents: number }> {
    try {
      const state = getStore();
      const allOrders = await state.getMarketplaceOrders([]);

      const totalCount = allOrders.length;
      const totalRevenueInCents = allOrders.reduce((sum, order) => sum + order.priceInCents, 0);

      return { totalCount, totalRevenueInCents };
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to get orders summary:',
        error instanceof Error ? error.message : String(error)
      );
      return { totalCount: 0, totalRevenueInCents: 0 };
    }
  }
}
