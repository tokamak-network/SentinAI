import { NextResponse } from 'next/server'
import { getTierInfo } from '@/lib/subscription-manager'

export async function GET() {
  const info = getTierInfo()
  return NextResponse.json({
    tier: info.tier,
    label: info.label,
    trialEndsAt: info.trialEndsAt,
    trialDaysRemaining: info.trialDaysRemaining,
    premiumFeatures: info.premiumFeatures,
  })
}
