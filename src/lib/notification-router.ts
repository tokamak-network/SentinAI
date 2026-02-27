/**
 * Notification Router
 * Routes approval requests to all active channels simultaneously.
 * When one channel approves, marks the others as "processed".
 */
import type { ApprovalRequest, ApprovalOutcome, NotificationResult } from '@/types/notification'
import { sendSlackApprovalRequest, editSlackMessage } from './notification-adapters/slack-adapter'
import { sendDiscordApprovalRequest, editDiscordMessage } from './notification-adapters/discord-adapter'
import { sendTelegramApprovalRequest, editTelegramMessage } from './notification-adapters/telegram-adapter'
import logger from '@/lib/logger'

// In-memory tracking: actionId → { channel → messageId }
const pendingMessages = new Map<string, Map<string, string>>()

/**
 * Send an approval request to ALL configured channels simultaneously.
 * Returns results per channel.
 */
export async function routeApprovalRequest(req: ApprovalRequest): Promise<NotificationResult[]> {
  const results = await Promise.allSettled([
    sendSlackApprovalRequest(req),
    sendDiscordApprovalRequest(req),
    sendTelegramApprovalRequest(req),
  ])

  const notificationResults: NotificationResult[] = []
  const msgIds = new Map<string, string>()

  for (const result of results) {
    if (result.status === 'fulfilled') {
      notificationResults.push(result.value)
      if (result.value.messageId) {
        msgIds.set(result.value.channel, result.value.messageId)
      }
    } else {
      logger.error('[NotificationRouter] Channel send failed:', result.reason)
    }
  }

  if (msgIds.size > 0) {
    pendingMessages.set(req.actionId, msgIds)
  }

  return notificationResults
}

/**
 * Called when an action is approved or rejected on any channel.
 * Updates all OTHER channels' messages to "✅ 처리됨" or "❌ 거부됨".
 */
export async function onActionDecided(outcome: ApprovalOutcome): Promise<void> {
  const msgIds = pendingMessages.get(outcome.actionId)
  if (!msgIds) return

  const statusText = outcome.approved
    ? `✅ 처리됨 — ${outcome.channel}에서 승인 (${outcome.decidedAt})`
    : `❌ 거부됨 — ${outcome.channel}에서 거부 (${outcome.decidedAt})`

  // Update all channels except where the decision was made
  const updates: Promise<void>[] = []
  for (const [channel, messageId] of msgIds.entries()) {
    if (channel === outcome.channel) continue // skip the deciding channel
    if (channel === 'slack') updates.push(editSlackMessage(messageId, statusText))
    if (channel === 'discord') updates.push(editDiscordMessage(messageId, statusText))
    if (channel === 'telegram') updates.push(editTelegramMessage(messageId, statusText))
  }

  await Promise.allSettled(updates)
  pendingMessages.delete(outcome.actionId)
}

/**
 * Mark all channels as expired for an action.
 */
export async function onActionExpired(actionId: string): Promise<void> {
  await onActionDecided({
    actionId,
    channel: 'dashboard',
    approved: false,
    decidedAt: new Date().toISOString(),
  })
}
