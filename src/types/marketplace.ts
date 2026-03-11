/**
 * Marketplace Types
 *
 * Manages dynamic pricing configuration and service catalog
 * stored in Redis, allowing runtime updates without redeployment.
 */

import type { ExperienceTier } from './agent-resume';

/**
 * Pricing for a single experience tier (in USD cents, for decimal precision).
 * Avoids floating-point precision issues by storing prices as integers.
 */
export interface TierPrice {
  /** Agent experience tier */
  tier: ExperienceTier;

  /** Price in USD cents (e.g., 19900 = $199.00) */
  priceCents: number;

  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}

/**
 * Complete marketplace pricing configuration.
 * All prices stored in USD cents for decimal precision.
 */
export interface MarketplacePricingConfig {
  /** Monthly price for trainee agents (USD cents) */
  traineePrice: number;

  /** Monthly price for junior agents (USD cents) */
  juniorPrice: number;

  /** Monthly price for senior agents (USD cents) */
  seniorPrice: number;

  /** Monthly price for expert agents (USD cents) */
  expertPrice: number;

  /** ISO 8601 timestamp of last update */
  updatedAt: string;

  /** Operator address that made the last update (optional) */
  updatedBy?: string;
}

/**
 * API request/response payload for updating pricing.
 * Supports partial updates — only specified tiers are modified.
 */
export interface PricingUpdateRequest {
  /** New price for trainee agents (cents), optional */
  traineePrice?: number;

  /** New price for junior agents (cents), optional */
  juniorPrice?: number;

  /** New price for senior agents (cents), optional */
  seniorPrice?: number;

  /** New price for expert agents (cents), optional */
  expertPrice?: number;
}

/**
 * Outcome bonus configuration for additional revenue sharing.
 * Future work: also make dynamic via Redis instead of hardcoded.
 */
export interface OutcomeBonusConfig {
  /** Bonus (USD cents) per auto-resolved incident */
  autoResolveBonusPerIncident: number;

  /** Threshold (number of monthly operations) for uptime bonus qualification */
  uptimeBonusThreshold: number;

  /** Bonus (USD cents) for meeting uptime threshold */
  uptimeBonusAmount: number;
}

/**
 * Individual service pricing entry in the marketplace catalog.
 * Services can be offered a la carte beyond the base agent tier pricing.
 */
export interface ServicePrice {
  /** Underscore-delimited service key (e.g., "scaling_history", "block_latency") */
  key: string;

  /** Human-readable service name (e.g., "Scaling History", "Block Latency Analysis") */
  displayName: string;

  /** Price per call in USD cents */
  priceCents: number;

  /** Optional service description for UI rendering */
  description?: string;
}

/**
 * Service catalog metadata for a particular agent.
 * Includes tier pricing and available services.
 */
export interface MarketplaceCatalog {
  /** Agent identity on the marketplace */
  agent: {
    /** Unique agent instance ID */
    id: string;

    /** Marketplace activation status ("active" | "suspended") */
    status: 'active' | 'suspended';
  };

  /** Available paid services beyond base tier pricing */
  services: ServicePrice[];

  /** Tier → monthly price mapping (USD cents) */
  pricingTiers: Record<ExperienceTier, number>;

  /** ISO 8601 timestamp of catalog generation */
  updatedAt: string;
}
