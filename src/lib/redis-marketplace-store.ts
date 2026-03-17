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
  DEFAULT_BRACKET_PRICING,
} from '@/lib/marketplace-store';
import type {
  MarketplacePricingConfig,
  PricingUpdateRequest,
  OutcomeBonusConfig,
  BracketPricingConfig,
  CatalogAgent,
  MarketplaceOrder,
} from '@/types/marketplace';
import { getStore } from '@/lib/redis-store';
import logger from '@/lib/logger';

/**
 * Lazy migration: convert legacy tier-based order to ops-score based order.
 */
function migrateOrder(order: any): MarketplaceOrder {
  // Already migrated
  if (order.opsScoreAtPurchase !== undefined && order.bracketLabel !== undefined) {
    return order as MarketplaceOrder;
  }

  // Legacy order with tier field — map to opsScore/bracketLabel
  const tierMapping: Record<string, { opsScore: number; bracketLabel: string }> = {
    trainee: { opsScore: 15, bracketLabel: 'Starter' },
    junior: { opsScore: 45, bracketLabel: 'Standard' },
    senior: { opsScore: 70, bracketLabel: 'Advanced' },
    expert: { opsScore: 90, bracketLabel: 'Expert' },
  };

  const mapping = tierMapping[order.tier] ?? { opsScore: 0, bracketLabel: 'Starter' };

  return {
    id: order.id,
    agentId: order.agentId,
    buyerAddress: order.buyerAddress,
    opsScoreAtPurchase: mapping.opsScore,
    bracketLabel: mapping.bracketLabel,
    priceInCents: order.priceInCents,
    createdAt: order.createdAt,
  };
}

/**
 * Lazy migration: convert legacy tier-based agent to status-based agent.
 */
function migrateCatalogAgent(agent: any): CatalogAgent {
  // Already migrated
  if (agent.status !== undefined && agent.tier === undefined) {
    return agent as CatalogAgent;
  }

  // Legacy agent with tier field — convert to status
  const { tier, ...rest } = agent;
  return {
    ...rest,
    status: rest.status ?? 'active',
  } as CatalogAgent;
}

/**
 * Redis-based implementation of IMarketplaceStore.
 */
export class RedisMarketplaceStore implements IMarketplaceStore {
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

  // =====================================================================
  // Bracket Pricing
  // =====================================================================

  async getBracketPricingConfig(): Promise<BracketPricingConfig> {
    try {
      const state = getStore();
      return await state.getMarketplaceBracketPricingConfig(DEFAULT_BRACKET_PRICING);
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to get bracket pricing config:',
        error instanceof Error ? error.message : String(error)
      );
      return DEFAULT_BRACKET_PRICING;
    }
  }

  async updateBracketPricing(config: BracketPricingConfig): Promise<BracketPricingConfig> {
    try {
      const state = getStore();
      const updated: BracketPricingConfig = {
        ...config,
        updatedAt: new Date().toISOString(),
      };

      await state.setMarketplaceBracketPricingConfig(updated);

      logger.info('[Marketplace Store] Bracket pricing updated:', {
        bracketCount: updated.brackets.length,
        updatedAt: updated.updatedAt,
      });

      return updated;
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to update bracket pricing:',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async resetBracketPricingToDefaults(): Promise<BracketPricingConfig> {
    try {
      const state = getStore();
      const reset: BracketPricingConfig = {
        ...DEFAULT_BRACKET_PRICING,
        updatedAt: new Date().toISOString(),
      };

      await state.setMarketplaceBracketPricingConfig(reset);

      logger.info('[Marketplace Store] Bracket pricing reset to defaults:', {
        updatedAt: reset.updatedAt,
      });

      return reset;
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to reset bracket pricing:',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  // =====================================================================
  // Bonus Config
  // =====================================================================

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

  // =====================================================================
  // Catalog Agents (with lazy migration from tier to status)
  // =====================================================================

  async getCatalogAgents(): Promise<CatalogAgent[]> {
    try {
      const state = getStore();
      const rawAgents = await state.getMarketplaceCatalogAgents([]);
      return rawAgents.map(migrateCatalogAgent);
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to get catalog agents:',
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

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
      agents.push(newAgent as any);
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

  async updateCatalogAgent(
    id: string,
    updates: Partial<Omit<CatalogAgent, 'id' | 'createdAt'>>
  ): Promise<CatalogAgent> {
    try {
      const state = getStore();
      const rawAgents = await state.getMarketplaceCatalogAgents([]);

      const agentIndex = rawAgents.findIndex((a: any) => a.id === id);
      if (agentIndex === -1) {
        throw new Error(`Agent not found: ${id}`);
      }

      const migrated = migrateCatalogAgent(rawAgents[agentIndex]);
      const updated: CatalogAgent = {
        ...migrated,
        ...updates,
        updatedAt: Date.now(),
      };

      rawAgents[agentIndex] = updated as any;
      await state.setMarketplaceCatalogAgents(rawAgents);

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

  async deleteCatalogAgent(id: string): Promise<CatalogAgent> {
    try {
      const state = getStore();
      const rawAgents = await state.getMarketplaceCatalogAgents([]);

      const agentIndex = rawAgents.findIndex((a: any) => a.id === id);
      if (agentIndex === -1) {
        throw new Error(`Agent not found: ${id}`);
      }

      const deleted = migrateCatalogAgent(rawAgents[agentIndex]);
      rawAgents.splice(agentIndex, 1);
      await state.setMarketplaceCatalogAgents(rawAgents);

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

  // =====================================================================
  // Orders (with lazy migration from tier to opsScore/bracketLabel)
  // =====================================================================

  async getOrders(page: number, limit: number): Promise<MarketplaceOrder[]> {
    try {
      const state = getStore();
      const allOrders = await state.getMarketplaceOrders([]);

      const start = (page - 1) * limit;
      const end = start + limit;
      return allOrders.slice(start, end).map(migrateOrder);
    } catch (error) {
      logger.error(
        '[Marketplace Store] Failed to get orders:',
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

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
      allOrders.push(newOrder as any);
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

  async getOrdersSummary(): Promise<{ totalCount: number; totalRevenueInCents: number }> {
    try {
      const state = getStore();
      const allOrders = await state.getMarketplaceOrders([]);

      const totalCount = allOrders.length;
      const totalRevenueInCents = allOrders.reduce((sum, order) => sum + (order as any).priceInCents, 0);

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
