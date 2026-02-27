/**
 * Unit Tests for NotificationRouter
 * Verifies multi-channel approval routing without real Slack/Discord/Telegram API calls.
 * All adapter functions are mocked via vi.mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApprovalRequest, ApprovalOutcome, NotificationResult } from '@/types/notification'

// ============================================================
// Mocks
// ============================================================

vi.mock('@/lib/notification-adapters/slack-adapter', () => ({
  sendSlackApprovalRequest: vi.fn(),
  editSlackMessage: vi.fn(),
}))

vi.mock('@/lib/notification-adapters/discord-adapter', () => ({
  sendDiscordApprovalRequest: vi.fn(),
  editDiscordMessage: vi.fn(),
}))

vi.mock('@/lib/notification-adapters/telegram-adapter', () => ({
  sendTelegramApprovalRequest: vi.fn(),
  editTelegramMessage: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  sendSlackApprovalRequest,
  editSlackMessage,
} from '@/lib/notification-adapters/slack-adapter'
import {
  sendDiscordApprovalRequest,
  editDiscordMessage,
} from '@/lib/notification-adapters/discord-adapter'
import {
  sendTelegramApprovalRequest,
  editTelegramMessage,
} from '@/lib/notification-adapters/telegram-adapter'

const mockSendSlack = vi.mocked(sendSlackApprovalRequest)
const mockSendDiscord = vi.mocked(sendDiscordApprovalRequest)
const mockSendTelegram = vi.mocked(sendTelegramApprovalRequest)
const mockEditSlack = vi.mocked(editSlackMessage)
const mockEditDiscord = vi.mocked(editDiscordMessage)
const mockEditTelegram = vi.mocked(editTelegramMessage)

// ============================================================
// Test Helpers
// ============================================================

function makeRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    actionId: 'act-001',
    token: 'tok-abc',
    description: '4 vCPU로 스케일업',
    riskLevel: 'medium',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    ...overrides,
  }
}

function makeOutcome(overrides?: Partial<ApprovalOutcome>): ApprovalOutcome {
  return {
    actionId: 'act-001',
    channel: 'slack',
    approved: true,
    decidedAt: new Date().toISOString(),
    ...overrides,
  }
}

function slackResult(messageId = 'slack-msg-1'): NotificationResult {
  return { channel: 'slack', success: true, messageId }
}

function discordResult(messageId = 'discord-msg-1'): NotificationResult {
  return { channel: 'discord', success: true, messageId }
}

function telegramResult(messageId = 'telegram-msg-1'): NotificationResult {
  return { channel: 'telegram', success: true, messageId }
}

// ============================================================
// Tests
// ============================================================

describe('NotificationRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the in-memory pendingMessages map between tests by re-importing.
    // Since the map is module-level, we rely on vi.resetModules() being called
    // or unique actionIds per test to avoid state leakage.
  })

  it('routeApprovalRequest sends to all configured channels', async () => {
    mockSendSlack.mockResolvedValue(slackResult())
    mockSendDiscord.mockResolvedValue(discordResult())
    mockSendTelegram.mockResolvedValue(telegramResult())

    const { routeApprovalRequest } = await import('@/lib/notification-router')
    const results = await routeApprovalRequest(makeRequest())

    expect(mockSendSlack).toHaveBeenCalledTimes(1)
    expect(mockSendDiscord).toHaveBeenCalledTimes(1)
    expect(mockSendTelegram).toHaveBeenCalledTimes(1)

    expect(results).toHaveLength(3)
    const channels = results.map((r) => r.channel)
    expect(channels).toContain('slack')
    expect(channels).toContain('discord')
    expect(channels).toContain('telegram')
  })

  it('routeApprovalRequest skips unconfigured channels gracefully', async () => {
    // Slack fails (misconfigured), Discord and Telegram succeed
    mockSendSlack.mockResolvedValue({ channel: 'slack', success: false, error: 'SLACK_BOT_TOKEN 미설정' })
    mockSendDiscord.mockResolvedValue(discordResult('discord-msg-2'))
    mockSendTelegram.mockResolvedValue(telegramResult('telegram-msg-2'))

    const { routeApprovalRequest } = await import('@/lib/notification-router')
    const results = await routeApprovalRequest(makeRequest({ actionId: 'act-002' }))

    // All three adapters were still called (routeApprovalRequest always tries all)
    expect(mockSendSlack).toHaveBeenCalledTimes(1)
    expect(mockSendDiscord).toHaveBeenCalledTimes(1)
    expect(mockSendTelegram).toHaveBeenCalledTimes(1)

    // Only successful results are returned
    const successResults = results.filter((r) => r.success)
    expect(successResults).toHaveLength(2)
  })

  it('onActionDecided updates pending messages in all channels', async () => {
    const actionId = 'act-003'
    mockSendSlack.mockResolvedValue(slackResult('slack-ts-003'))
    mockSendDiscord.mockResolvedValue(discordResult('discord-id-003'))
    mockSendTelegram.mockResolvedValue(telegramResult('telegram-id-003'))
    mockEditSlack.mockResolvedValue()
    mockEditDiscord.mockResolvedValue()
    mockEditTelegram.mockResolvedValue()

    const { routeApprovalRequest, onActionDecided } = await import('@/lib/notification-router')

    // First, route request to register pending messages
    await routeApprovalRequest(makeRequest({ actionId }))

    // Then, decide from Slack — should update Discord and Telegram
    await onActionDecided(makeOutcome({ actionId, channel: 'slack', approved: true }))

    // Discord and Telegram should be updated (not Slack — it was the deciding channel)
    expect(mockEditDiscord).toHaveBeenCalledTimes(1)
    expect(mockEditTelegram).toHaveBeenCalledTimes(1)
    expect(mockEditSlack).not.toHaveBeenCalled()
  })

  it('onActionExpired marks all pending messages as expired', async () => {
    const actionId = 'act-004'
    mockSendSlack.mockResolvedValue(slackResult('slack-ts-004'))
    mockSendDiscord.mockResolvedValue(discordResult('discord-id-004'))
    mockSendTelegram.mockResolvedValue(telegramResult('telegram-id-004'))
    mockEditSlack.mockResolvedValue()
    mockEditDiscord.mockResolvedValue()
    mockEditTelegram.mockResolvedValue()

    const { routeApprovalRequest, onActionExpired } = await import('@/lib/notification-router')

    await routeApprovalRequest(makeRequest({ actionId }))

    // onActionExpired delegates to onActionDecided with channel='dashboard'
    // so all three channels (slack, discord, telegram) should be updated
    await onActionExpired(actionId)

    // dashboard is the deciding channel — all real channels get updated
    expect(mockEditSlack).toHaveBeenCalledTimes(1)
    expect(mockEditDiscord).toHaveBeenCalledTimes(1)
    expect(mockEditTelegram).toHaveBeenCalledTimes(1)
  })

  it('ActionRequest with riskLevel high is sent correctly', async () => {
    const req = makeRequest({
      actionId: 'act-005',
      riskLevel: 'high',
      description: '긴급 스케일업: 8 vCPU',
      chainId: 'thanos-sepolia',
    })

    mockSendSlack.mockResolvedValue(slackResult())
    mockSendDiscord.mockResolvedValue(discordResult())
    mockSendTelegram.mockResolvedValue(telegramResult())

    const { routeApprovalRequest } = await import('@/lib/notification-router')
    const results = await routeApprovalRequest(req)

    // Verify the full request object was passed to each adapter
    expect(mockSendSlack).toHaveBeenCalledWith(req)
    expect(mockSendDiscord).toHaveBeenCalledWith(req)
    expect(mockSendTelegram).toHaveBeenCalledWith(req)

    // All three channels should succeed
    expect(results.every((r) => r.success)).toBe(true)
  })
})
