/**
 * Unified Approval Callback Route
 * Receives button clicks from Slack, Discord, Telegram.
 * Verifies signature → delegates to approval-engine → updates other channels.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifySlackSignature } from '@/lib/notification-adapters/slack-adapter'
import { verifyDiscordSignature } from '@/lib/notification-adapters/discord-adapter'
import { verifyTelegramToken } from '@/lib/notification-adapters/telegram-adapter'
import { onActionDecided } from '@/lib/notification-router'
import type { ApprovalOutcome } from '@/types/notification'
import logger from '@/lib/logger'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const platform = req.headers.get('x-platform') ?? req.headers.get('x-forwarded-platform')
  const body = await req.text()

  // --- Slack ---
  if (platform === 'slack' || req.headers.get('x-slack-signature')) {
    const signingSecret = process.env.SLACK_SIGNING_SECRET
    if (!signingSecret) return NextResponse.json({ error: 'SLACK_SIGNING_SECRET 미설정' }, { status: 401 })

    const timestamp = req.headers.get('x-slack-request-timestamp') ?? ''
    const signature = req.headers.get('x-slack-signature') ?? ''

    if (!verifySlackSignature(signingSecret, timestamp, body, signature)) {
      return NextResponse.json({ error: '서명 검증 실패' }, { status: 401 })
    }

    const payload = JSON.parse(decodeURIComponent(body.replace('payload=', ''))) as {
      actions?: Array<{ value?: string }>
      user?: { name?: string }
    }
    const action = payload.actions?.[0]
    if (!action?.value) return NextResponse.json({ ok: true })

    const { actionId, decision } = JSON.parse(action.value) as { actionId: string; decision: string }
    const outcome: ApprovalOutcome = {
      actionId,
      channel: 'slack',
      approved: decision === 'approve',
      approvedBy: payload.user?.name,
      decidedAt: new Date().toISOString(),
    }
    await onActionDecided(outcome)
    logger.info(`[ApprovalCallback] Slack: ${actionId} → ${decision}`)
    return NextResponse.json({ ok: true })
  }

  // --- Discord ---
  if (platform === 'discord' || req.headers.get('x-signature-ed25519')) {
    const publicKey = process.env.DISCORD_APPLICATION_PUBLIC_KEY
    if (!publicKey) return NextResponse.json({ error: 'DISCORD_APPLICATION_PUBLIC_KEY 미설정' }, { status: 401 })

    const timestamp = req.headers.get('x-signature-timestamp') ?? ''
    const signature = req.headers.get('x-signature-ed25519') ?? ''

    const valid = await verifyDiscordSignature(publicKey, timestamp, body, signature)
    if (!valid) return NextResponse.json({ error: '서명 검증 실패' }, { status: 401 })

    const parsed = JSON.parse(body) as { type?: number; data?: { custom_id?: string }; member?: { user?: { username?: string } } }
    // Discord PING
    if (parsed.type === 1) return NextResponse.json({ type: 1 })

    const customId = parsed.data?.custom_id ?? ''
    const { actionId, decision } = JSON.parse(customId) as { actionId: string; decision: string }
    const outcome: ApprovalOutcome = {
      actionId,
      channel: 'discord',
      approved: decision === 'approve',
      approvedBy: parsed.member?.user?.username,
      decidedAt: new Date().toISOString(),
    }
    await onActionDecided(outcome)
    // Discord requires immediate ACK
    return NextResponse.json({ type: 6 })
  }

  // --- Telegram ---
  if (platform === 'telegram' || req.headers.get('x-telegram-bot-api-secret-token')) {
    const secretToken = process.env.TELEGRAM_SECRET_TOKEN
    if (secretToken) {
      const headerToken = req.headers.get('x-telegram-bot-api-secret-token') ?? ''
      if (!verifyTelegramToken(secretToken, headerToken)) {
        return NextResponse.json({ error: '토큰 검증 실패' }, { status: 401 })
      }
    }

    const update = JSON.parse(body) as {
      callback_query?: {
        id?: string
        data?: string
        from?: { username?: string }
      }
    }
    const cbData = update.callback_query?.data
    if (!cbData) return NextResponse.json({ ok: true })

    const { actionId, decision } = JSON.parse(cbData) as { actionId: string; decision: string }
    const outcome: ApprovalOutcome = {
      actionId,
      channel: 'telegram',
      approved: decision === 'approve',
      approvedBy: update.callback_query?.from?.username,
      decidedAt: new Date().toISOString(),
    }
    await onActionDecided(outcome)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'x-platform 헤더 누락 (slack | discord | telegram)' }, { status: 400 })
}
