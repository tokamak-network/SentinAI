/**
 * Marketplace Store — Dynamic pricing configuration management
 *
 * Abstract interface for storing and retrieving marketplace pricing configuration
 * and outcome bonus settings. Supports both Redis and in-memory implementations
 * for dependency injection and testing.
 */

import type {
  MarketplacePricingConfig,
  PricingUpdateRequest,
  OutcomeBonusConfig,
  BracketPricingConfig,
  CatalogAgent,
  MarketplaceOrder,
} from '@/types/marketplace';
import { RedisMarketplaceStore } from '@/lib/redis-marketplace-store';

/**
 * Default pricing configuration (in USD cents).
 * - trainee: $0
 * - junior: $199
 * - senior: $499
 * - expert: $799
 */
export const DEFAULT_PRICING: MarketplacePricingConfig = {
  traineePrice: 0,
  juniorPrice: 19900, // $199.00
  seniorPrice: 49900, // $499.00
  expertPrice: 79900, // $799.00
  updatedAt: new Date().toISOString(),
};

/**
 * Default bracket pricing configuration.
 * Brackets sorted by floor descending.
 */
export const DEFAULT_BRACKET_PRICING: BracketPricingConfig = {
  brackets: [
    { floor: 80, priceCents: 79900, label: 'Expert' },
    { floor: 60, priceCents: 49900, label: 'Advanced' },
    { floor: 30, priceCents: 19900, label: 'Standard' },
    { floor: 0, priceCents: 0, label: 'Starter' },
  ],
  updatedAt: new Date().toISOString(),
};

/**
 * Default outcome bonus configuration (in USD cents).
 * - autoResolveBonus: $1.00 per auto-resolved incident
 * - uptimeBonusThreshold: 30 monthly operations
 * - uptimeBonusAmount: $5.00 for meeting threshold
 */
export const DEFAULT_BONUS_CONFIG: OutcomeBonusConfig = {
  autoResolveBonusPerIncident: 100, // $1.00
  uptimeBonusThreshold: 30,
  uptimeBonusAmount: 500, // $5.00
};

/**
 * Abstract interface for marketplace pricing store.
 * Implementations handle Redis or in-memory persistence.
 */
export interface IMarketplaceStore {
  /**
   * Retrieve current pricing configuration.
   *
   * @returns Promise resolving to MarketplacePricingConfig
   */
  getPricingConfig(): Promise<MarketplacePricingConfig>;

  /**
   * Update pricing configuration with partial overrides.
   * Only specified tiers are modified; others remain unchanged.
   *
   * @param update - Partial pricing update (optional tier prices)
   * @returns Promise resolving to updated MarketplacePricingConfig
   */
  updatePricing(update: PricingUpdateRequest): Promise<MarketplacePricingConfig>;

  /**
   * Reset pricing configuration to defaults.
   *
   * @returns Promise resolving to default MarketplacePricingConfig
   */
  resetPricingToDefaults(): Promise<MarketplacePricingConfig>;

  /**
   * Retrieve current outcome bonus configuration.
   *
   * @returns Promise resolving to OutcomeBonusConfig
   */
  getBonusConfig(): Promise<OutcomeBonusConfig>;

  /**
   * Update outcome bonus configuration with partial overrides.
   *
   * @param update - Partial bonus configuration update
   * @returns Promise resolving to updated OutcomeBonusConfig
   */
  updateBonusConfig(
    update: Partial<OutcomeBonusConfig>
  ): Promise<OutcomeBonusConfig>;

  /**
   * Retrieve all catalog agents from marketplace.
   *
   * @returns Promise resolving to array of CatalogAgent
   */
  getCatalogAgents(): Promise<CatalogAgent[]>;

  /**
   * Create a new catalog agent.
   *
   * @param agent - CatalogAgent without id (auto-generated)
   * @returns Promise resolving to created CatalogAgent with id
   */
  createCatalogAgent(
    agent: Omit<CatalogAgent, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<CatalogAgent>;

  /**
   * Update an existing catalog agent.
   *
   * @param id - Agent ID
   * @param updates - Partial agent updates
   * @returns Promise resolving to updated CatalogAgent
   */
  updateCatalogAgent(
    id: string,
    updates: Partial<Omit<CatalogAgent, 'id' | 'createdAt'>>
  ): Promise<CatalogAgent>;

  /**
   * Delete a catalog agent.
   *
   * @param id - Agent ID
   * @returns Promise resolving to deleted CatalogAgent
   */
  deleteCatalogAgent(id: string): Promise<CatalogAgent>;

  /**
   * Retrieve paginated list of marketplace orders.
   *
   * @param page - Page number (1-indexed)
   * @param limit - Items per page
   * @returns Promise resolving to array of MarketplaceOrder
   */
  getOrders(page: number, limit: number): Promise<MarketplaceOrder[]>;

  /**
   * Create a new marketplace order.
   *
   * @param order - MarketplaceOrder without id (auto-generated)
   * @returns Promise resolving to created MarketplaceOrder with id
   */
  createOrder(
    order: Omit<MarketplaceOrder, 'id'>
  ): Promise<MarketplaceOrder>;

  /**
   * Get orders summary (total count, revenue).
   *
   * @returns Promise resolving to { totalCount, totalRevenueInCents }
   */
  getOrdersSummary(): Promise<{ totalCount: number; totalRevenueInCents: number }>;

  /**
   * Retrieve bracket pricing configuration.
   */
  getBracketPricingConfig(): Promise<BracketPricingConfig>;

  /**
   * Update bracket pricing configuration.
   */
  updateBracketPricing(config: BracketPricingConfig): Promise<BracketPricingConfig>;

  /**
   * Reset bracket pricing to defaults.
   */
  resetBracketPricingToDefaults(): Promise<BracketPricingConfig>;
}

// ---------------------------------------------------------------------------
// Singleton management
// ---------------------------------------------------------------------------

/** Global marketplace store instance */
let marketplaceStore: IMarketplaceStore | null = null;

/**
 * Initialize or replace the global marketplace store instance.
 * Used for dependency injection in tests and production.
 *
 * @param store - IMarketplaceStore implementation (Redis or in-memory)
 */
export function setMarketplaceStore(store: IMarketplaceStore): void {
  marketplaceStore = store;
}

/**
 * Retrieve the global marketplace store instance.
 * Must be initialized via setMarketplaceStore before calling.
 *
 * @returns Global IMarketplaceStore instance
 * @throws Error if store not initialized
 */
export function getMarketplaceStore(): IMarketplaceStore {
  if (!marketplaceStore) {
    marketplaceStore = new RedisMarketplaceStore();
  }
  return marketplaceStore;
}
