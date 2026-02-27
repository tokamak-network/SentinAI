export type SubscriptionTier = 'general' | 'premium' | 'enterprise'

export interface PremiumFeatures {
  customPlaybooks: boolean
  thresholdTuning: boolean
  slackChannel: string
  monthlyReviewDate?: string
}

export interface TierInfo {
  tier: SubscriptionTier
  label: string
  trialEndsAt?: string
  trialDaysRemaining?: number
  premiumFeatures?: PremiumFeatures
}
