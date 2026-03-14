/**
 * Marketplace Types
 *
 * Manages dynamic pricing configuration and service catalog
 * stored in Redis, allowing runtime updates without redeployment.
 */

import type { ExperienceTier } from './agent-resume';
import type {
  IncidentPattern,
  RemediationAction,
  PromptUsageMetrics,
  PatternContext,
  EvolvedPlaybook,
  ABTestResult,
  ABTestState,
  ABTestSession,
} from '../lib/types/playbook-evolution';

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

// Re-export playbook evolution types for convenience
export type {
  IncidentPattern,
  RemediationAction,
  PromptUsageMetrics,
  PatternContext,
  EvolvedPlaybook,
  ABTestResult,
  ABTestState,
  ABTestSession,
};
