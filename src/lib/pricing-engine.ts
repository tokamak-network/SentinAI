/**
 * Pricing Engine — Agent-for-Hire Tier-Based Pricing
 *
 * Calculates monthly pricing based on agent experience tier
 * and outcome-based performance bonuses.
 *
 * Pricing tiers (from agent-resume.ts calculateTier):
 *   trainee (<30 days):    Free
 *   junior  (30-89 days):  $199/chain/month
 *   senior  (90-179 days): $499/chain/month
 *   expert  (180+ days):   $799/chain/month
 *
 * Outcome bonuses:
 *   auto-resolved incident:        $50-200 (severity-based)
 *   99.9%+ uptime month:           $500
 *   cost savings execution:        10% of savings
 */

import { generateResume } from '@/lib/agent-resume';
import { getExperienceByInstance } from '@/lib/experience-store';
import { getMarketplaceStore } from '@/lib/marketplace-store';
import type { ExperienceTier } from '@/types/agent-resume';
import type { MarketplacePricingConfig } from '@/types/marketplace';
import type { OutcomeBonus, PricingResult } from '@/types/billing';
import logger from '@/lib/logger';

/** Monthly rate per chain by tier (USD). */
export const TIER_PRICING: Record<ExperienceTier, number> = {
  trainee: 0,
  junior: 199,
  senior: 499,
  expert: 799,
};

/** Base bonus for an auto-resolved incident. */
const AUTO_RESOLVE_BONUS = 100;

/**
 * Load outcome bonus configuration from marketplace store or return defaults.
 */
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

/**
 * Calculate outcome bonuses from this month's experience entries.
 */
export async function calculateOutcomeBonuses(
  entries: Array<{ outcome: string; category: string; resolutionMs: number }>,
): Promise<OutcomeBonus[]> {
  const bonusConfig = await loadBonusConfig();
  const bonuses: OutcomeBonus[] = [];

  // Count auto-resolved incidents this month
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

  // Uptime bonus: if no failures in remediation/scaling this month
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

/**
 * Calculate complete pricing for an agent instance.
 */
export async function calculatePricing(
  instanceId: string,
  protocolId: string,
): Promise<PricingResult> {
  const resume = await generateResume(instanceId, protocolId);

  // Get this month's experience entries
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const allEntries = await getExperienceByInstance(instanceId, 5000);
  const monthEntries = allEntries.filter((e) => new Date(e.timestamp) >= monthStart);

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

  const outcomeBonuses = await calculateOutcomeBonuses(monthEntries);
  const bonusTotal = outcomeBonuses.reduce((sum, b) => sum + b.amount, 0);

  return {
    instanceId,
    tier: resume.tier,
    monthlyRate,
    outcomeBonuses,
    totalMonthlyValue: monthlyRate + bonusTotal,
    calculatedAt: new Date().toISOString(),
  };
}
