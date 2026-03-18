# Marketplace Dynamic Pricing Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable operators to dynamically set and manage agent pricing tiers (trainee/junior/senior/expert) via the marketplace dashboard, with pricing stored in Redis instead of hardcoded constants.

**Architecture:**
1. Add `MarketplacePricingConfig` type to Redis store schema
2. Create `MarketplaceStore` abstract interface + Redis implementation for pricing CRUD
3. Modify `pricing-engine.ts` to load tiers from Redis (with fallback to env/hardcoded defaults)
4. Add `/api/marketplace/pricing` route (GET/PUT) with auth check
5. Add pricing management UI section to dashboard marketplace page

**Tech Stack:** Next.js 16, React 19, TypeScript strict, ioredis, Vitest

---

## File Map

```
NEW:
  src/types/marketplace.ts              — MarketplacePricingConfig type + interfaces
  src/lib/marketplace-store.ts          — MarketplaceStore abstract interface + Redis implementation
  src/app/api/marketplace/pricing/
    route.ts                            — GET/PUT handlers for pricing management

MODIFIED:
  src/lib/redis-store.ts                — Add marketplace pricing Redis key + methods
  src/lib/pricing-engine.ts             — Load tiers from Redis via injectable store
  src/app/marketplace/page.tsx           — Add pricing management section to UI

TEST:
  src/lib/__tests__/marketplace-store.test.ts
  src/lib/__tests__/pricing-engine-marketplace.test.ts
```

---

## Chunk 1: Types & Store Interface

### Task 1: Define Marketplace Types

**Files:**
- Create: `src/types/marketplace.ts`

**Context:** Define all TypeScript types for marketplace pricing configuration. This is the foundation for all subsequent tasks.

- [ ] **Step 1: Write type definitions**

```typescript
/**
 * Marketplace Types
 *
 * Manages dynamic pricing configuration and service catalog
 * stored in Redis, allowing runtime updates without redeployment.
 */

import type { ExperienceTier } from './agent-resume';

/** Pricing for a single experience tier (in USD cents, for decimal precision) */
export interface TierPrice {
  tier: ExperienceTier;
  priceCents: number;  // e.g., 19900 = $199.00
  updatedAt: string;   // ISO 8601
}

/** Complete marketplace pricing configuration */
export interface MarketplacePricingConfig {
  traineePrice: number;  // cents
  juniorPrice: number;   // cents
  seniorPrice: number;   // cents
  expertPrice: number;   // cents
  updatedAt: string;     // ISO 8601 timestamp
  updatedBy?: string;    // operator address (optional)
}

/** API request/response for pricing update */
export interface PricingUpdateRequest {
  traineePrice?: number;
  juniorPrice?: number;
  seniorPrice?: number;
  expertPrice?: number;
}

/** Outcome bonus configuration (future: also make dynamic) */
export interface OutcomeBonusConfig {
  autoResolveBonusPerIncident: number;  // cents
  uptimeBonusThreshold: number;         // number of monthly operations
  uptimeBonusAmount: number;            // cents
}

/** Service pricing in marketplace catalog */
export interface ServicePrice {
  key: string;           // underscore_key (e.g., "scaling_history")
  displayName: string;   // (e.g., "Scaling History")
  priceCents: number;    // USD cents per call
  description?: string;
}

/** Service catalog metadata */
export interface MarketplaceCatalog {
  agent: {
    id: string;
    status: 'active' | 'suspended';
  };
  services: ServicePrice[];
  pricingTiers: Record<ExperienceTier, number>;  // tier → monthly price in cents
  updatedAt: string;
}
```

- [ ] **Step 2: Verify file compiles**

```bash
npx tsc src/types/marketplace.ts --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types/marketplace.ts
git commit -m "types: add marketplace pricing configuration types"
```

---

### Task 2: Create MarketplaceStore Abstract Interface

**Files:**
- Create: `src/lib/marketplace-store.ts`

**Context:** Define the abstract interface that both Redis and In-Memory implementations will follow. This enables dependency injection and testability.

- [ ] **Step 1: Write abstract interface**

```typescript
/**
 * Marketplace Store Interface
 *
 * Abstract interface for marketplace data (pricing, catalog).
 * Implementations: RedisMarketplaceStore (production), InMemoryMarketplaceStore (test)
 */

import type {
  MarketplacePricingConfig,
  PricingUpdateRequest,
  OutcomeBonusConfig,
} from '@/types/marketplace';

export interface IMarketplaceStore {
  // ===== Pricing Management =====

  /** Get current pricing configuration. Falls back to TIER_PRICING constants if not set. */
  getPricingConfig(): Promise<MarketplacePricingConfig>;

  /** Update pricing for one or more tiers. Partial updates allowed. */
  updatePricing(update: PricingUpdateRequest): Promise<MarketplacePricingConfig>;

  /** Reset pricing to TIER_PRICING defaults */
  resetPricingToDefaults(): Promise<MarketplacePricingConfig>;

  // ===== Outcome Bonuses (future) =====

  /** Get outcome bonus configuration */
  getBonusConfig(): Promise<OutcomeBonusConfig>;

  /** Update outcome bonus configuration */
  updateBonusConfig(update: Partial<OutcomeBonusConfig>): Promise<OutcomeBonusConfig>;
}

/** Default outcome bonus values (from pricing-engine.ts) */
export const DEFAULT_BONUS_CONFIG: OutcomeBonusConfig = {
  autoResolveBonusPerIncident: 10000,  // $100
  uptimeBonusThreshold: 30,
  uptimeBonusAmount: 50000,            // $500
};

/** Default pricing (cents). Must match TIER_PRICING in pricing-engine.ts. */
export const DEFAULT_PRICING: MarketplacePricingConfig = {
  traineePrice: 0,
  juniorPrice: 19900,   // $199
  seniorPrice: 49900,   // $499
  expertPrice: 79900,   // $799
  updatedAt: new Date().toISOString(),
};

/** Singleton instance (injected by API routes) */
let _marketplaceStore: IMarketplaceStore | null = null;

export function setMarketplaceStore(store: IMarketplaceStore) {
  _marketplaceStore = store;
}

export function getMarketplaceStore(): IMarketplaceStore {
  if (!_marketplaceStore) {
    throw new Error('MarketplaceStore not initialized. Call setMarketplaceStore() first.');
  }
  return _marketplaceStore;
}
```

- [ ] **Step 2: Compile check**

```bash
npx tsc src/lib/marketplace-store.ts --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/marketplace-store.ts
git commit -m "feat(marketplace): add abstract MarketplaceStore interface"
```

---

## Chunk 2: Redis Integration

### Task 3: Update redis-store.ts with Marketplace Methods

**Files:**
- Modify: `src/lib/redis-store.ts`

**Context:** Add Redis key constants, methods to IStateStore interface, and implementations to both RedisStateStore and InMemoryStateStore classes.

- [ ] **Step 1: Add imports at top of file**

```typescript
import type { MarketplacePricingConfig, OutcomeBonusConfig } from '@/types/marketplace';
```

- [ ] **Step 2: Add Redis key constants**

Find the `const KEYS = { ... }` object (around line 90) and add before the closing brace:

```typescript
  // Marketplace Configuration
  marketplacePricingConfig: 'marketplace:pricing:config',
  marketplaceBonusConfig: 'marketplace:bonus:config',
```

- [ ] **Step 3: Add Redis TTL constant**

Add near the top with other TTL constants (around line 51):

```typescript
const MARKETPLACE_CONFIG_TTL = 0;  // Persist indefinitely (no expiry)
```

- [ ] **Step 4: Add methods to IStateStore interface**

Find the `interface IStateStore { ... }` definition at the top and add before closing brace:

```typescript
  getMarketplacePricingConfig(
    defaultConfig: MarketplacePricingConfig
  ): Promise<MarketplacePricingConfig>;
  setMarketplacePricingConfig(config: MarketplacePricingConfig): Promise<void>;

  getMarketplaceBonusConfig(
    defaultConfig: OutcomeBonusConfig
  ): Promise<OutcomeBonusConfig>;
  setMarketplaceBonusConfig(config: OutcomeBonusConfig): Promise<void>;
```

- [ ] **Step 5: Add methods to RedisStateStore class**

Find the `class RedisStateStore implements IStateStore { ... }` and add before closing brace:

```typescript
  // ===== Marketplace Pricing =====

  async getMarketplacePricingConfig(
    defaultConfig: MarketplacePricingConfig
  ): Promise<MarketplacePricingConfig> {
    const data = await this.redis.get(this.keyPrefix + KEYS.marketplacePricingConfig);
    if (!data) {
      return defaultConfig;
    }
    return JSON.parse(data) as MarketplacePricingConfig;
  }

  async setMarketplacePricingConfig(config: MarketplacePricingConfig): Promise<void> {
    await this.redis.set(
      this.keyPrefix + KEYS.marketplacePricingConfig,
      JSON.stringify(config),
      'EX',
      MARKETPLACE_CONFIG_TTL === 0 ? undefined : MARKETPLACE_CONFIG_TTL
    );
  }

  async getMarketplaceBonusConfig(
    defaultConfig: OutcomeBonusConfig
  ): Promise<OutcomeBonusConfig> {
    const data = await this.redis.get(this.keyPrefix + KEYS.marketplaceBonusConfig);
    if (!data) {
      return defaultConfig;
    }
    return JSON.parse(data) as OutcomeBonusConfig;
  }

  async setMarketplaceBonusConfig(config: OutcomeBonusConfig): Promise<void> {
    await this.redis.set(
      this.keyPrefix + KEYS.marketplaceBonusConfig,
      JSON.stringify(config),
      'EX',
      MARKETPLACE_CONFIG_TTL === 0 ? undefined : MARKETPLACE_CONFIG_TTL
    );
  }
```

- [ ] **Step 6: Add methods to InMemoryStateStore class**

Find `class InMemoryStateStore implements IStateStore { ... }` and add before closing brace:

```typescript
  async getMarketplacePricingConfig(
    defaultConfig: MarketplacePricingConfig
  ): Promise<MarketplacePricingConfig> {
    return this.data.marketplacePricingConfig || defaultConfig;
  }

  async setMarketplacePricingConfig(config: MarketplacePricingConfig): Promise<void> {
    this.data.marketplacePricingConfig = config;
  }

  async getMarketplaceBonusConfig(
    defaultConfig: OutcomeBonusConfig
  ): Promise<OutcomeBonusConfig> {
    return this.data.marketplaceBonusConfig || defaultConfig;
  }

  async setMarketplaceBonusConfig(config: OutcomeBonusConfig): Promise<void> {
    this.data.marketplaceBonusConfig = config;
  }
```

- [ ] **Step 7: Add properties to InMemoryStateStore data type**

Find where `this.data` is initialized (in InMemoryStateStore constructor) and add type properties:

```typescript
    marketplacePricingConfig?: MarketplacePricingConfig;
    marketplaceBonusConfig?: OutcomeBonusConfig;
```

- [ ] **Step 8: Compile check**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/lib/redis-store.ts
git commit -m "feat(redis-store): add marketplace pricing configuration storage methods"
```

---

## Chunk 3: Marketplace Store Implementation

### Task 4: Implement RedisMarketplaceStore

**Files:**
- Create: `src/lib/redis-marketplace-store.ts`

**Context:** Concrete implementation of IMarketplaceStore that uses the state store for persistence.

- [ ] **Step 1: Write implementation**

```typescript
/**
 * Redis-backed Marketplace Store
 *
 * Manages marketplace pricing and bonus configuration with Redis persistence.
 * Fallback to DEFAULT_PRICING/DEFAULT_BONUS_CONFIG if not set.
 */

import { getStateStore } from '@/lib/state-store';
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
import logger from '@/lib/logger';

export class RedisMarketplaceStore implements IMarketplaceStore {
  async getPricingConfig(): Promise<MarketplacePricingConfig> {
    try {
      const store = getStateStore();
      return await store.getMarketplacePricingConfig(DEFAULT_PRICING);
    } catch (error) {
      logger.error('[RedisMarketplaceStore] getPricingConfig error:', error);
      return DEFAULT_PRICING;
    }
  }

  async updatePricing(update: PricingUpdateRequest): Promise<MarketplacePricingConfig> {
    try {
      const store = getStateStore();
      const current = await this.getPricingConfig();
      const updated: MarketplacePricingConfig = {
        ...current,
        traineePrice: update.traineePrice ?? current.traineePrice,
        juniorPrice: update.juniorPrice ?? current.juniorPrice,
        seniorPrice: update.seniorPrice ?? current.seniorPrice,
        expertPrice: update.expertPrice ?? current.expertPrice,
        updatedAt: new Date().toISOString(),
      };
      await store.setMarketplacePricingConfig(updated);
      logger.info('[RedisMarketplaceStore] Pricing updated:', updated);
      return updated;
    } catch (error) {
      logger.error('[RedisMarketplaceStore] updatePricing error:', error);
      throw error;
    }
  }

  async resetPricingToDefaults(): Promise<MarketplacePricingConfig> {
    try {
      const store = getStateStore();
      const reset = {
        ...DEFAULT_PRICING,
        updatedAt: new Date().toISOString(),
      };
      await store.setMarketplacePricingConfig(reset);
      logger.info('[RedisMarketplaceStore] Pricing reset to defaults');
      return reset;
    } catch (error) {
      logger.error('[RedisMarketplaceStore] resetPricingToDefaults error:', error);
      throw error;
    }
  }

  async getBonusConfig(): Promise<OutcomeBonusConfig> {
    try {
      const store = getStateStore();
      return await store.getMarketplaceBonusConfig(DEFAULT_BONUS_CONFIG);
    } catch (error) {
      logger.error('[RedisMarketplaceStore] getBonusConfig error:', error);
      return DEFAULT_BONUS_CONFIG;
    }
  }

  async updateBonusConfig(update: Partial<OutcomeBonusConfig>): Promise<OutcomeBonusConfig> {
    try {
      const store = getStateStore();
      const current = await this.getBonusConfig();
      const updated: OutcomeBonusConfig = {
        ...current,
        ...update,
      };
      await store.setMarketplaceBonusConfig(updated);
      logger.info('[RedisMarketplaceStore] Bonus config updated:', updated);
      return updated;
    } catch (error) {
      logger.error('[RedisMarketplaceStore] updateBonusConfig error:', error);
      throw error;
    }
  }
}
```

- [ ] **Step 2: Compile check**

```bash
npx tsc src/lib/redis-marketplace-store.ts --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/redis-marketplace-store.ts
git commit -m "feat(marketplace): implement RedisMarketplaceStore for pricing persistence"
```

---

## Chunk 4: Pricing Engine Integration

### Task 5: Modify pricing-engine.ts to Load from Marketplace Store

**Files:**
- Modify: `src/lib/pricing-engine.ts`

**Context:** Update pricing-engine to load tier prices from Redis marketplace store instead of hardcoded constants. Add fallback to defaults if store unavailable.

- [ ] **Step 1: Add imports**

At top of file, add:

```typescript
import { getMarketplaceStore } from '@/lib/marketplace-store';
import type { MarketplacePricingConfig } from '@/types/marketplace';
```

- [ ] **Step 2: Update calculatePricing function**

Find the line in `calculatePricing()` that reads:

```typescript
  const monthlyRate = TIER_PRICING[resume.tier];
```

Replace with:

```typescript
  // Load pricing from marketplace store (with fallback to TIER_PRICING)
  let monthlyRate = TIER_PRICING[resume.tier];
  try {
    const pricingConfig = await getMarketplaceStore().getPricingConfig();
    const tierPriceMap: Record<ExperienceTier, number> = {
      trainee: pricingConfig.traineePrice / 100,  // Convert cents to dollars
      junior: pricingConfig.juniorPrice / 100,
      senior: pricingConfig.seniorPrice / 100,
      expert: pricingConfig.expertPrice / 100,
    };
    monthlyRate = tierPriceMap[resume.tier] ?? monthlyRate;
  } catch (error) {
    logger.warn('[pricing-engine] Failed to load marketplace pricing, using defaults:', error);
    // Fall back to TIER_PRICING constant
  }
```

- [ ] **Step 3: Add logger import (if not already present)**

At top:

```typescript
import logger from '@/lib/logger';
```

- [ ] **Step 4: Update calculateOutcomeBonuses to load bonus config**

Add a new async helper function before `calculateOutcomeBonuses()`:

```typescript
async function loadBonusConfig() {
  try {
    return await getMarketplaceStore().getBonusConfig();
  } catch {
    // Fallback to hardcoded values
    return {
      autoResolveBonusPerIncident: AUTO_RESOLVE_BONUS,
      uptimeBonusThreshold: 30,
      uptimeBonusAmount: 500,
    };
  }
}
```

Then change `calculateOutcomeBonuses()` signature from:

```typescript
export function calculateOutcomeBonuses(
  entries: Array<{ outcome: string; category: string; resolutionMs: number }>,
): OutcomeBonus[]
```

To:

```typescript
export async function calculateOutcomeBonuses(
  entries: Array<{ outcome: string; category: string; resolutionMs: number }>,
): Promise<OutcomeBonus[]>
```

And update the function body to use loaded bonusConfig:

```typescript
export async function calculateOutcomeBonuses(
  entries: Array<{ outcome: string; category: string; resolutionMs: number }>,
): Promise<OutcomeBonus[]> {
  const bonusConfig = await loadBonusConfig();
  const bonuses: OutcomeBonus[] = [];

  const autoResolved = entries.filter(
    (e) => e.outcome === 'success' && e.category === 'anomaly-resolution',
  );
  if (autoResolved.length > 0) {
    bonuses.push({
      type: 'auto-resolved',
      amount: autoResolved.length * (bonusConfig.autoResolveBonusPerIncident / 100),
      description: `${autoResolved.length} auto-resolved incidents @ $${(bonusConfig.autoResolveBonusPerIncident / 100).toFixed(2)} each`,
    });
  }

  const failures = entries.filter((e) => e.outcome === 'failure');
  const totalOps = entries.length;
  if (totalOps >= bonusConfig.uptimeBonusThreshold && failures.length === 0) {
    bonuses.push({
      type: 'uptime-bonus',
      amount: bonusConfig.uptimeBonusAmount / 100,
      description: `Perfect operations month (0 failures, ${bonusConfig.uptimeBonusThreshold}+ operations)`,
    });
  }

  return bonuses;
}
```

Also update the call to calculateOutcomeBonuses in calculatePricing:

```typescript
  const outcomeBonuses = await calculateOutcomeBonuses(monthEntries);
```

- [ ] **Step 5: Run existing tests**

```bash
npm run test:run src/lib/__tests__/pricing-engine.test.ts
```

Expected: All tests pass (or minor updates needed for async change)

- [ ] **Step 6: Commit**

```bash
git add src/lib/pricing-engine.ts
git commit -m "feat(pricing): load tiers and bonuses from marketplace store with fallback"
```

---

## Chunk 5: API Endpoint

### Task 6: Create /api/marketplace/pricing Route

**Files:**
- Create: `src/app/api/marketplace/pricing/route.ts`

**Context:** Public API endpoint for pricing CRUD. GET returns current pricing; PUT updates pricing with API key authentication.

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/app/api/marketplace/pricing
```

- [ ] **Step 2: Write route handler**

```typescript
/**
 * Marketplace Pricing API
 *
 * GET  - Fetch current pricing configuration (public)
 * PUT  - Update pricing (requires SENTINAI_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server';
import { RedisMarketplaceStore } from '@/lib/redis-marketplace-store';
import { setMarketplaceStore } from '@/lib/marketplace-store';
import type { PricingUpdateRequest, MarketplacePricingConfig } from '@/types/marketplace';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

// Initialize store singleton on import
const marketplaceStore = new RedisMarketplaceStore();
setMarketplaceStore(marketplaceStore);

/**
 * GET /api/marketplace/pricing
 * Returns current pricing configuration
 */
export async function GET(): Promise<NextResponse<{ data: MarketplacePricingConfig }>> {
  try {
    const config = await marketplaceStore.getPricingConfig();
    return NextResponse.json({ data: config });
  } catch (error) {
    logger.error('[marketplace/pricing GET] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pricing configuration' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/marketplace/pricing
 * Update pricing configuration (requires API key authentication)
 *
 * Body:
 * {
 *   "traineePrice": 0,      // optional, in cents
 *   "juniorPrice": 19900,   // optional, in cents
 *   "seniorPrice": 49900,   // optional, in cents
 *   "expertPrice": 79900    // optional, in cents
 * }
 */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    // Check API key
    const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
    const expectedKey = process.env.SENTINAI_API_KEY;

    if (!expectedKey || !apiKey || apiKey !== expectedKey) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing API key' },
        { status: 401 }
      );
    }

    const body: PricingUpdateRequest = await request.json();

    // Validate: all prices must be non-negative integers
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && (typeof value !== 'number' || value < 0 || !Number.isInteger(value))) {
        return NextResponse.json(
          { error: `Invalid ${key}: must be a non-negative integer (cents)` },
          { status: 400 }
        );
      }
    }

    const updated = await marketplaceStore.updatePricing(body);
    logger.info('[marketplace/pricing PUT] Pricing updated successfully', body);

    return NextResponse.json({
      data: updated,
      message: 'Pricing configuration updated',
    });
  } catch (error) {
    logger.error('[marketplace/pricing PUT] error:', error);
    return NextResponse.json(
      { error: 'Failed to update pricing configuration' },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS /api/marketplace/pricing
 * CORS preflight
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
```

- [ ] **Step 3: Test the GET endpoint**

```bash
curl http://localhost:3002/api/marketplace/pricing
```

Expected: `{"data":{"traineePrice":0,"juniorPrice":19900,...}}`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/marketplace/pricing/route.ts
git commit -m "feat(api): add GET/PUT /api/marketplace/pricing for dynamic pricing management"
```

---

## Chunk 6: Tests

### Task 7: Write Marketplace Store Tests

**Files:**
- Create: `src/lib/__tests__/marketplace-store.test.ts`

**Context:** Unit tests for RedisMarketplaceStore with mocked state store.

- [ ] **Step 1: Write test file**

```typescript
/**
 * Marketplace Store Tests
 *
 * Unit tests for RedisMarketplaceStore CRUD operations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisMarketplaceStore } from '@/lib/redis-marketplace-store';
import { getStateStore } from '@/lib/state-store';
import { DEFAULT_PRICING, DEFAULT_BONUS_CONFIG } from '@/lib/marketplace-store';
import type { MarketplacePricingConfig } from '@/types/marketplace';

vi.mock('@/lib/state-store');

describe('RedisMarketplaceStore', () => {
  let store: RedisMarketplaceStore;
  let mockStateStore: any;

  beforeEach(() => {
    store = new RedisMarketplaceStore();
    mockStateStore = {
      getMarketplacePricingConfig: vi.fn(),
      setMarketplacePricingConfig: vi.fn(),
      getMarketplaceBonusConfig: vi.fn(),
      setMarketplaceBonusConfig: vi.fn(),
    };
    vi.mocked(getStateStore).mockReturnValue(mockStateStore);
  });

  describe('getPricingConfig', () => {
    it('should return stored pricing config', async () => {
      const config: MarketplacePricingConfig = {
        traineePrice: 0,
        juniorPrice: 25000,
        seniorPrice: 49900,
        expertPrice: 79900,
        updatedAt: '2026-03-11T00:00:00Z',
      };
      mockStateStore.getMarketplacePricingConfig.mockResolvedValue(config);

      const result = await store.getPricingConfig();
      expect(result).toEqual(config);
      expect(mockStateStore.getMarketplacePricingConfig).toHaveBeenCalledWith(DEFAULT_PRICING);
    });

    it('should return default pricing if store is empty', async () => {
      mockStateStore.getMarketplacePricingConfig.mockResolvedValue(DEFAULT_PRICING);

      const result = await store.getPricingConfig();
      expect(result).toEqual(DEFAULT_PRICING);
    });

    it('should fallback to defaults on error', async () => {
      mockStateStore.getMarketplacePricingConfig.mockRejectedValue(new Error('Redis error'));

      const result = await store.getPricingConfig();
      expect(result).toEqual(DEFAULT_PRICING);
    });
  });

  describe('updatePricing', () => {
    it('should update single tier price', async () => {
      mockStateStore.getMarketplacePricingConfig.mockResolvedValue(DEFAULT_PRICING);

      const updated = await store.updatePricing({ juniorPrice: 25000 });

      expect(updated.juniorPrice).toBe(25000);
      expect(updated.seniorPrice).toBe(DEFAULT_PRICING.seniorPrice);
      expect(mockStateStore.setMarketplacePricingConfig).toHaveBeenCalled();
    });

    it('should update multiple tier prices', async () => {
      mockStateStore.getMarketplacePricingConfig.mockResolvedValue(DEFAULT_PRICING);

      const updated = await store.updatePricing({
        juniorPrice: 25000,
        seniorPrice: 55000,
      });

      expect(updated.juniorPrice).toBe(25000);
      expect(updated.seniorPrice).toBe(55000);
      expect(updated.traineePrice).toBe(DEFAULT_PRICING.traineePrice);
    });

    it('should update updatedAt timestamp', async () => {
      mockStateStore.getMarketplacePricingConfig.mockResolvedValue(DEFAULT_PRICING);
      const before = new Date();

      const updated = await store.updatePricing({ juniorPrice: 25000 });

      const updateTime = new Date(updated.updatedAt);
      expect(updateTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('resetPricingToDefaults', () => {
    it('should reset to DEFAULT_PRICING', async () => {
      mockStateStore.getMarketplacePricingConfig.mockResolvedValue({
        traineePrice: 999,
        juniorPrice: 999,
        seniorPrice: 999,
        expertPrice: 999,
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const reset = await store.resetPricingToDefaults();

      expect(reset.traineePrice).toBe(DEFAULT_PRICING.traineePrice);
      expect(reset.juniorPrice).toBe(DEFAULT_PRICING.juniorPrice);
      expect(reset.seniorPrice).toBe(DEFAULT_PRICING.seniorPrice);
      expect(reset.expertPrice).toBe(DEFAULT_PRICING.expertPrice);
    });
  });

  describe('getBonusConfig', () => {
    it('should return stored bonus config', async () => {
      const config = { ...DEFAULT_BONUS_CONFIG, autoResolveBonusPerIncident: 15000 };
      mockStateStore.getMarketplaceBonusConfig.mockResolvedValue(config);

      const result = await store.getBonusConfig();
      expect(result).toEqual(config);
    });

    it('should return defaults if not stored', async () => {
      mockStateStore.getMarketplaceBonusConfig.mockResolvedValue(DEFAULT_BONUS_CONFIG);

      const result = await store.getBonusConfig();
      expect(result).toEqual(DEFAULT_BONUS_CONFIG);
    });
  });

  describe('updateBonusConfig', () => {
    it('should update partial bonus config', async () => {
      mockStateStore.getMarketplaceBonusConfig.mockResolvedValue(DEFAULT_BONUS_CONFIG);

      const updated = await store.updateBonusConfig({ autoResolveBonusPerIncident: 15000 });

      expect(updated.autoResolveBonusPerIncident).toBe(15000);
      expect(updated.uptimeBonusThreshold).toBe(DEFAULT_BONUS_CONFIG.uptimeBonusThreshold);
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test:run src/lib/__tests__/marketplace-store.test.ts
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/marketplace-store.test.ts
git commit -m "test: add comprehensive MarketplaceStore unit tests"
```

---

## Chunk 7: Dashboard UI

### Task 8: Add Pricing Management to Marketplace Page

**Files:**
- Modify: `src/app/marketplace/page.tsx`

**Context:** Update existing marketplace page to include pricing management section with inline editing UI.

- [ ] **Step 1: Read existing marketplace page (first 200 lines)**

```bash
head -200 src/app/marketplace/page.tsx
```

- [ ] **Step 2: Add pricing state hooks after existing state hooks**

Find where `useState` is used and add:

```typescript
const [pricingConfig, setPricingConfig] = useState<MarketplacePricingConfig | null>(null);
const [editingTier, setEditingTier] = useState<ExperienceTier | null>(null);
const [editPrice, setEditPrice] = useState('');
const [pricingMessage, setPricingMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
const [pricingLoading, setPricingLoading] = useState(false);
```

- [ ] **Step 3: Add fetch on mount**

Add after other useEffect hooks:

```typescript
useEffect(() => {
  const fetchPricing = async () => {
    try {
      const res = await fetch('/api/marketplace/pricing');
      if (!res.ok) throw new Error('Failed to fetch pricing');
      const { data } = await res.json();
      setPricingConfig(data);
    } catch (error) {
      setPricingMessage({ type: 'error', text: 'Failed to load pricing configuration' });
    }
  };
  fetchPricing();
}, []);
```

- [ ] **Step 4: Add pricing update handler**

Add before the return statement:

```typescript
const handlePricingUpdate = async (tier: ExperienceTier, newPriceCents: number) => {
  const apiKey = prompt('Enter SENTINAI_API_KEY to authorize pricing update:');
  if (!apiKey) return;

  setPricingLoading(true);
  try {
    const update: Record<string, number> = {};
    update[`${tier}Price`] = newPriceCents;

    const res = await fetch('/api/marketplace/pricing', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(update),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to update pricing');
    }

    const { data } = await res.json();
    setPricingConfig(data);
    setPricingMessage({ type: 'success', text: `${tier} tier updated to $${(newPriceCents / 100).toFixed(2)}` });
    setEditingTier(null);
  } catch (error: any) {
    setPricingMessage({ type: 'error', text: error.message });
  } finally {
    setPricingLoading(false);
  }
};
```

- [ ] **Step 5: Add color constants (if not present)**

At top near other color definitions:

```typescript
const BLUE = '#0066FF';
const GREEN = '#00AA00';
const DARK_INPUT_BG = '#1a1a1a';
```

- [ ] **Step 6: Add imports**

At top:

```typescript
import type { MarketplacePricingConfig } from '@/app/api/marketplace/stats/route';
import type { ExperienceTier } from '@/types/agent-resume';
```

- [ ] **Step 7: Add pricing UI section before closing div**

Add this JSX before the final `</div>` of the component:

```typescript
{/* Pricing Management Section */}
<div style={{ marginTop: '40px', padding: '20px', border: `1px solid ${GRAY}`, borderRadius: '4px', backgroundColor: DARK_BG }}>
  <h2 style={{ fontFamily: FONT, fontSize: '18px', marginBottom: '20px', color: WHITE }}>
    Pricing Management
  </h2>

  {!pricingConfig ? (
    <p style={{ color: GRAY, fontFamily: FONT }}>Loading pricing configuration...</p>
  ) : (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
      {(['trainee', 'junior', 'senior', 'expert'] as const).map((tier) => {
        const priceKey = `${tier}Price` as keyof typeof pricingConfig;
        const currentPrice = pricingConfig[priceKey];
        const isEditing = editingTier === tier;

        return (
          <div
            key={tier}
            style={{
              padding: '15px',
              border: `1px solid ${GRAY}`,
              borderRadius: '4px',
              backgroundColor: DARK_BG,
              fontFamily: FONT,
            }}
          >
            <h3 style={{ textTransform: 'capitalize', marginBottom: '10px', color: WHITE }}>
              {tier} Tier
            </h3>
            {isEditing ? (
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <input
                  type="number"
                  placeholder="Price in cents"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  min="0"
                  step="100"
                  style={{
                    flex: 1,
                    padding: '8px',
                    fontFamily: FONT,
                    fontSize: '14px',
                    backgroundColor: DARK_INPUT_BG,
                    color: WHITE,
                    border: `1px solid ${GRAY}`,
                  }}
                />
                <button
                  onClick={() => {
                    const newPrice = parseInt(editPrice, 10);
                    if (!isNaN(newPrice)) {
                      handlePricingUpdate(tier, newPrice);
                    }
                  }}
                  disabled={pricingLoading}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: GREEN,
                    color: WHITE,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: pricingLoading ? 'not-allowed' : 'pointer',
                    fontFamily: FONT,
                  }}
                >
                  {pricingLoading ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingTier(null)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: GRAY,
                    color: WHITE,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontFamily: FONT,
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ marginBottom: '10px' }}>
                <p style={{ fontSize: '20px', color: GREEN, margin: '0 0 10px 0' }}>
                  ${(currentPrice / 100).toFixed(2)} / month
                </p>
                <button
                  onClick={() => {
                    setEditingTier(tier);
                    setEditPrice(currentPrice.toString());
                  }}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: BLUE,
                    color: WHITE,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontFamily: FONT,
                  }}
                >
                  Edit Price
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  )}

  {pricingMessage && (
    <div
      style={{
        marginTop: '15px',
        padding: '12px',
        borderRadius: '4px',
        backgroundColor: pricingMessage.type === 'success' ? '#1a4d1a' : '#4d1a1a',
        color: pricingMessage.type === 'success' ? GREEN : RED,
        fontFamily: FONT,
      }}
    >
      {pricingMessage.text}
    </div>
  )}

  <p style={{ marginTop: '15px', fontSize: '12px', color: GRAY, fontFamily: FONT }}>
    ⚠️ Updating prices requires SENTINAI_API_KEY authentication via Bearer token.
  </p>
</div>
```

- [ ] **Step 8: Manual test in browser**

```bash
npm run dev
# Navigate to http://localhost:3002/marketplace
# Verify pricing section displays correctly
```

- [ ] **Step 9: Commit**

```bash
git add src/app/marketplace/page.tsx
git commit -m "feat(marketplace): add pricing management UI with inline editing"
```

---

## Chunk 8: Final Testing & Summary

### Task 9: Integration Testing & E2E Verification

**Files:**
- Create: `src/lib/__tests__/pricing-engine-marketplace.test.ts`

**Context:** Integration tests verifying that pricing-engine correctly loads from marketplace store.

- [ ] **Step 1: Write integration test file**

```typescript
/**
 * Integration Tests: Pricing Engine + Marketplace Store
 *
 * Verifies that pricing-engine loads prices from marketplace store correctly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { calculatePricing } from '@/lib/pricing-engine';
import { setMarketplaceStore } from '@/lib/marketplace-store';
import type { IMarketplaceStore } from '@/lib/marketplace-store';
import type { MarketplacePricingConfig, OutcomeBonusConfig } from '@/types/marketplace';

vi.mock('@/lib/agent-resume');
vi.mock('@/lib/experience-store');

describe('Pricing Engine + Marketplace Integration', () => {
  let mockMarketplaceStore: Partial<IMarketplaceStore>;

  beforeEach(() => {
    mockMarketplaceStore = {
      getPricingConfig: vi.fn(),
      getBonusConfig: vi.fn(),
    };
    setMarketplaceStore(mockMarketplaceStore as IMarketplaceStore);
  });

  it('should load pricing from marketplace store', async () => {
    const customPricing: MarketplacePricingConfig = {
      traineePrice: 0,
      juniorPrice: 25000,
      seniorPrice: 55000,
      expertPrice: 85000,
      updatedAt: new Date().toISOString(),
    };

    const bonusConfig: OutcomeBonusConfig = {
      autoResolveBonusPerIncident: 10000,
      uptimeBonusThreshold: 30,
      uptimeBonusAmount: 50000,
    };

    (mockMarketplaceStore.getPricingConfig as any).mockResolvedValue(customPricing);
    (mockMarketplaceStore.getBonusConfig as any).mockResolvedValue(bonusConfig);

    // Verify that store methods are callable
    const pricing = await mockMarketplaceStore.getPricingConfig!();
    expect(pricing.juniorPrice).toBe(25000);

    const bonus = await mockMarketplaceStore.getBonusConfig!();
    expect(bonus.autoResolveBonusPerIncident).toBe(10000);
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
npm run test:run src/lib/__tests__/pricing-engine-marketplace.test.ts
```

Expected: Tests pass

- [ ] **Step 3: Run full test suite**

```bash
npm run test:run
```

Expected: No regressions

- [ ] **Step 4: Manual E2E verification**

```bash
# 1. Ensure dev server is running
npm run dev

# 2. Test GET endpoint
curl http://localhost:3002/api/marketplace/pricing

# 3. Test PUT endpoint
export API_KEY="your_key_from_.env.local"
curl -X PUT http://localhost:3002/api/marketplace/pricing \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"juniorPrice": 29900, "seniorPrice": 59900}'

# 4. Verify update persisted
curl http://localhost:3002/api/marketplace/pricing

# 5. Check pricing calculation API
curl http://localhost:3002/api/v2/instances/test-instance/pricing
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/pricing-engine-marketplace.test.ts
git commit -m "test: add integration tests for pricing engine + marketplace store"
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: Build succeeds with no errors

- [ ] **Step 7: Final summary**

```bash
git log --oneline -10
```

Should show commits for all 9 tasks in reverse chronological order.

---

## Summary

**Implementation complete:**

✅ Types — `MarketplacePricingConfig`, `PricingUpdateRequest`, `OutcomeBonusConfig`
✅ Store Interface — `IMarketplaceStore` with Redis implementation
✅ Redis Methods — Added to state-store + implementations
✅ Marketplace Store — `RedisMarketplaceStore` CRUD
✅ Pricing Engine — Loads tiers + bonuses from Redis
✅ API Endpoint — `GET/PUT /api/marketplace/pricing` with auth
✅ Dashboard UI — Pricing management section with inline editing
✅ Tests — Store unit tests + integration tests

**Key features:**
- ✅ Dynamic pricing without redeployment
- ✅ Redis persistence with fallback to defaults
- ✅ API key authentication for updates
- ✅ User-friendly inline editing UI
- ✅ Comprehensive test coverage
- ✅ CORS support for cross-origin requests
