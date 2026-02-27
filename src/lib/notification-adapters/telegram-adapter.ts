/**
 * Telegram Adapter — Inline Keyboard + secret_token header verification
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_SECRET_TOKEN
 */
import { createHmac, timingSafeEqual } from 'crypto'
import type { ApprovalRequest, NotificationResult } from '@/types/notification'

export async function sendTelegramApprovalRequest(req: ApprovalRequest): Promise<NotificationResult> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) {
    return { channel: 'telegram', success: false, error: 'TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID 미설정' }
  }

  const riskEmoji: Record<string, string> = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' }
  const text = [
    `${riskEmoji[req.riskLevel] ?? '⚪'} *승인 요청*`,
    `${req.description}`,
    req.chainId ? `체인: \`${req.chainId}\`` : '',
    `위험도: *${req.riskLevel}*`,
    `만료: ${req.expiresAt}`,
  ].filter(Boolean).join('\n')

  const approveData = JSON.stringify({ actionId: req.actionId, token: req.token, decision: 'approve' })
  const rejectData = JSON.stringify({ actionId: req.actionId, token: req.token, decision: 'reject' })

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ 승인', callback_data: approveData.slice(0, 64) },
            { text: '❌ 거부', callback_data: rejectData.slice(0, 64) },
          ]],
        },
      }),
    })
    const data = await res.json() as { ok: boolean; result?: { message_id?: number }; description?: string }
    if (!data.ok) return { channel: 'telegram', success: false, error: data.description }
    return { channel: 'telegram', success: true, messageId: String(data.result?.message_id) }
  } catch (err) {
    return { channel: 'telegram', success: false, error: String(err) }
  }
}

export async function editTelegramMessage(messageId: string, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId || !messageId) return

  await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: parseInt(messageId), text, reply_markup: { inline_keyboard: [] } }),
  }).catch(() => {})
}

/**
 * Verify Telegram webhook secret_token header.
 * token = HMAC-SHA256(secret_token) of the header value.
 */
export function verifyTelegramToken(secretToken: string, headerValue: string): boolean {
  try {
    const expected = createHmac('sha256', 'WebAppData').update(secretToken).digest('hex')
    return timingSafeEqual(Buffer.from(expected), Buffer.from(headerValue))
  } catch {
    return false
  }
}
