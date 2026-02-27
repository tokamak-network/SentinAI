/**
 * Unit Tests for FeatureGate
 * Tests gate logic against subscription tiers: general, premium, enterprise.
 * Uses vi.mock to override SENTINAI_TIER env var via subscription-manager mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkGate } from '@/lib/feature-gate'

// ============================================================
// Mocks
// ============================================================

vi.mock('@/lib/subscription-manager', () => ({
  isPremium: vi.fn(),
}))

import { isPremium } from '@/lib/subscription-manager'

const mockIsPremium = vi.mocked(isPremium)

// ============================================================
// Tests
// ============================================================

describe('FeatureGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('checkGate returns included:true when tier is premium', () => {
    mockIsPremium.mockReturnValue(true)

    const result = checkGate('custom-playbooks')

    expect(result.included).toBe(true)
    expect(result.nudgeMessage).toBeUndefined()
  })

  it('checkGate returns included:false with nudgeMessage when tier is general', () => {
    mockIsPremium.mockReturnValue(false)

    const result = checkGate('threshold-tuning')

    expect(result.included).toBe(false)
    expect(result.nudgeMessage).toBeTruthy()
    expect(typeof result.nudgeMessage).toBe('string')
  })

  it('checkGate returns included:true for all features when tier is enterprise', () => {
    // enterprise also returns true from isPremium()
    mockIsPremium.mockReturnValue(true)

    const features = [
      'custom-playbooks',
      'threshold-tuning',
      'incident-co-response',
      'monthly-review',
      'priority-protocol-support',
    ] as const

    for (const feature of features) {
      const result = checkGate(feature)
      expect(result.included).toBe(true)
    }
  })

  it('nudgeMessage is non-empty string when feature is not included', () => {
    mockIsPremium.mockReturnValue(false)

    const features = [
      'custom-playbooks',
      'threshold-tuning',
      'incident-co-response',
      'monthly-review',
      'priority-protocol-support',
    ] as const

    for (const feature of features) {
      const result = checkGate(feature)
      expect(result.nudgeMessage).toBeTruthy()
      expect(result.nudgeMessage!.length).toBeGreaterThan(0)
    }
  })

  it('checkGate never throws — always returns object', () => {
    mockIsPremium.mockReturnValue(false)

    const features = [
      'custom-playbooks',
      'threshold-tuning',
      'incident-co-response',
      'monthly-review',
      'priority-protocol-support',
    ] as const

    for (const feature of features) {
      expect(() => checkGate(feature)).not.toThrow()
      const result = checkGate(feature)
      expect(result).toBeTypeOf('object')
      expect(result).not.toBeNull()
    }
  })

  it('all 5 premium features are recognized with distinct nudge messages', () => {
    mockIsPremium.mockReturnValue(false)

    const features = [
      'custom-playbooks',
      'threshold-tuning',
      'incident-co-response',
      'monthly-review',
      'priority-protocol-support',
    ] as const

    const messages = features.map((f) => checkGate(f).nudgeMessage)

    // All messages must be defined and non-empty
    messages.forEach((msg) => {
      expect(msg).toBeTruthy()
      expect(typeof msg).toBe('string')
    })

    // All nudge messages must be unique
    const unique = new Set(messages)
    expect(unique.size).toBe(features.length)
  })
})
