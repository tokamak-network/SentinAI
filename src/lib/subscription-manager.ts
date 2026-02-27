import type { SubscriptionTier, TierInfo } from '@/types/subscription'

export function getTierInfo(): TierInfo {
  const tier = (process.env.SENTINAI_TIER ?? 'general') as SubscriptionTier
  const trialEndsAt = process.env.SENTINAI_TRIAL_ENDS_AT

  let trialDaysRemaining: number | undefined
  if (trialEndsAt) {
    const days = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    trialDaysRemaining = Math.max(0, days)
  }

  const labels: Record<SubscriptionTier, string> = {
    general: 'General (무료)',
    premium: 'Premium ($299/체인/월)',
    enterprise: 'Enterprise',
  }

  const info: TierInfo = { tier, label: labels[tier], trialEndsAt, trialDaysRemaining }

  if (tier === 'premium' || tier === 'enterprise') {
    info.premiumFeatures = {
      customPlaybooks: true,
      thresholdTuning: true,
      slackChannel: process.env.SENTINAI_SLACK_CHANNEL_URL ?? '',
    }
  }

  return info
}

export function isPremium(): boolean {
  const tier = process.env.SENTINAI_TIER ?? 'general'
  return tier === 'premium' || tier === 'enterprise'
}

export function getTrialDaysRemaining(): number | null {
  const trialEndsAt = process.env.SENTINAI_TRIAL_ENDS_AT
  if (!trialEndsAt) return null
  const days = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  return Math.max(0, days)
}
