/**
 * Marketplace Types
 *
 * Manages dynamic pricing configuration and service catalog
 * stored in Redis, allowing runtime updates without redeployment.
 */

import type { ExperienceTier } from './agent-resume';

// =====================================================================
// Ops-Score Based Pricing (new)
// =====================================================================

/** 운영 점수 기반 가격 구간 */
export interface PricingBracket {
  floor: number;        // 최소 opsScore (0-100)
  priceCents: number;   // 월 USD cents
  label: string;        // 관리자 정의 라벨 (예: "Starter")
}

/** 구간별 가격 설정 */
export interface BracketPricingConfig {
  brackets: PricingBracket[];  // floor 내림차순 정렬
  updatedAt: string;
  updatedBy?: string;
}

/** 운영 점수 상세 내역 */
export interface OpsBreakdown {
  slaScore: number;           // sla-tracker (0-100)
  reputationScore: number;    // reputation-state-store (0-100)
  successRate: number;        // experience-store (0-1)
  avgResolutionMs: number;    // experience-store
  totalOperations: number;    // lifetime stats
  operatingDays: number;      // experience-store
  domainCoverage: number;     // 활성 도메인 수 (0-5)
}

// =====================================================================
// Legacy Tier-Based Pricing (@deprecated)
// =====================================================================

/** @deprecated Use PricingBracket instead */
export interface TierPrice {
  tier: ExperienceTier;
  priceCents: number;  // e.g., 19900 = $199.00
  updatedAt: string;   // ISO 8601
}

/** @deprecated Use BracketPricingConfig instead */
export interface MarketplacePricingConfig {
  traineePrice: number;  // cents
  juniorPrice: number;   // cents
  seniorPrice: number;   // cents
  expertPrice: number;   // cents
  updatedAt: string;     // ISO 8601 timestamp
  updatedBy?: string;    // operator address (optional)
}

/** @deprecated Use BracketPricingConfig instead */
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
  /** @deprecated Use BracketPricingConfig instead */
  pricingTiers: Record<ExperienceTier, number>;  // tier → monthly price in cents
  updatedAt: string;
}

/** Catalog Agent in marketplace admin */
export interface CatalogAgent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  status: 'active' | 'suspended' | 'probation';
  createdAt: number;
  updatedAt: number;
}

/** Marketplace Order (transaction record) */
export interface MarketplaceOrder {
  id: string;
  agentId: string;
  buyerAddress: string;
  opsScoreAtPurchase: number;   // 구매 시점 스냅샷
  bracketLabel: string;          // 적용된 구간 라벨
  priceInCents: number;
  createdAt: number;
}
