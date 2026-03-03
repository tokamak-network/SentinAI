/**
 * Slack Adapter — Block Kit buttons + HMAC-SHA256 signing secret verification
 * Env: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_CHANNEL_ID
 */
import { createHmac, timingSafeEqual } from 'crypto'
import type { ApprovalRequest, NotificationResult } from '@/types/notification'

const WEBHOOK_TIMEOUT_MS = parseInt(process.env.WEBHOOK_TIMEOUT_MS || '5000', 10)

function buildBlocks(req: ApprovalRequest) {
  const riskEmoji: Record<string, string> = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' }
  return {
    text: `[${req.riskLevel.toUpperCase()}] 승인 요청: ${req.description}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${riskEmoji[req.riskLevel] ?? '⚪'} *승인 요청*\n${req.description}`,
        },
      },
      ...(req.chainId ? [{
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*체인*\n${req.chainId}` },
          { type: 'mrkdwn', text: `*위험도*\n${req.riskLevel}` },
        ],
      }] : []),
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*만료*: <!date^${Math.floor(new Date(req.expiresAt).getTime() / 1000)}^{date_short_pretty} {time}|${req.expiresAt}>` },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ 승인' },
            style: 'primary',
            action_id: 'approve',
            value: JSON.stringify({ actionId: req.actionId, token: req.token, decision: 'approve' }),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ 거부' },
            style: 'danger',
            action_id: 'reject',
            value: JSON.stringify({ actionId: req.actionId, token: req.token, decision: 'reject' }),
          },
        ],
      },
    ],
  }
}

export async function sendSlackApprovalRequest(req: ApprovalRequest): Promise<NotificationResult> {
  const token = process.env.SLACK_BOT_TOKEN
  const channelId = process.env.SLACK_CHANNEL_ID
  if (!token || !channelId) {
    return { channel: 'slack', success: false, error: 'SLACK_BOT_TOKEN 또는 SLACK_CHANNEL_ID 미설정' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
  try {
    const body = { channel: channelId, ...buildBlocks(req) }
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const data = await res.json() as { ok: boolean; ts?: string; error?: string }
    if (!data.ok) return { channel: 'slack', success: false, error: data.error }
    return { channel: 'slack', success: true, messageId: data.ts }
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      return { channel: 'slack' as const, success: false, error: `Slack API timeout after ${WEBHOOK_TIMEOUT_MS}ms` }
    }
    return { channel: 'slack', success: false, error: String(err) }
  }
}

export async function editSlackMessage(messageId: string, text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN
  const channelId = process.env.SLACK_CHANNEL_ID
  if (!token || !channelId || !messageId) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
  try {
    await fetch('https://slack.com/api/chat.update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel: channelId, ts: messageId, text }),
      signal: controller.signal,
    })
    clearTimeout(timer)
  } catch {
    clearTimeout(timer)
    // Silently ignore errors (same as original .catch(() => {}))
  }
}

/**
 * Verify Slack request signature (HMAC-SHA256).
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  const sigBase = `v0:${timestamp}:${body}`
  const expected = `v0=${createHmac('sha256', signingSecret).update(sigBase).digest('hex')}`
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}
