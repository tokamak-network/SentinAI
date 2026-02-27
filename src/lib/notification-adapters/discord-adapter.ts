/**
 * Discord Adapter — Message Components buttons + Ed25519 verification
 * Env: DISCORD_BOT_TOKEN, DISCORD_APPLICATION_PUBLIC_KEY, DISCORD_CHANNEL_ID
 */
import type { ApprovalRequest, NotificationResult } from '@/types/notification'

function buildComponents(req: ApprovalRequest) {
  const riskEmoji: Record<string, string> = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' }
  return {
    embeds: [{
      title: `${riskEmoji[req.riskLevel] ?? '⚪'} 승인 요청`,
      description: req.description,
      color: req.riskLevel === 'critical' ? 0xFF0000 : req.riskLevel === 'high' ? 0xFF8C00 : 0x5865F2,
      fields: [
        ...(req.chainId ? [{ name: '체인', value: req.chainId, inline: true }] : []),
        { name: '위험도', value: req.riskLevel, inline: true },
        { name: '만료', value: req.expiresAt, inline: false },
      ],
    }],
    components: [{
      type: 1, // Action Row
      components: [
        {
          type: 2, // Button
          style: 3, // SUCCESS (green)
          label: '✅ 승인',
          custom_id: JSON.stringify({ actionId: req.actionId, token: req.token, decision: 'approve' }).slice(0, 100),
        },
        {
          type: 2,
          style: 4, // DANGER (red)
          label: '❌ 거부',
          custom_id: JSON.stringify({ actionId: req.actionId, token: req.token, decision: 'reject' }).slice(0, 100),
        },
      ],
    }],
  }
}

export async function sendDiscordApprovalRequest(req: ApprovalRequest): Promise<NotificationResult> {
  const token = process.env.DISCORD_BOT_TOKEN
  const channelId = process.env.DISCORD_CHANNEL_ID
  if (!token || !channelId) {
    return { channel: 'discord', success: false, error: 'DISCORD_BOT_TOKEN 또는 DISCORD_CHANNEL_ID 미설정' }
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
      body: JSON.stringify(buildComponents(req)),
    })
    const data = await res.json() as { id?: string; message?: string }
    if (!res.ok) return { channel: 'discord', success: false, error: data.message }
    return { channel: 'discord', success: true, messageId: data.id }
  } catch (err) {
    return { channel: 'discord', success: false, error: String(err) }
  }
}

export async function editDiscordMessage(messageId: string, text: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN
  const channelId = process.env.DISCORD_CHANNEL_ID
  if (!token || !channelId || !messageId) return

  await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
    body: JSON.stringify({ content: text, components: [] }),
  }).catch(() => {})
}

/**
 * Verify Discord interaction signature using Ed25519.
 * Uses Web Crypto API (available in Node.js 18+).
 */
export async function verifyDiscordSignature(
  publicKey: string,
  timestamp: string,
  body: string,
  signature: string
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      Buffer.from(publicKey, 'hex'),
      { name: 'Ed25519' },
      false,
      ['verify']
    )
    const message = Buffer.from(timestamp + body)
    const sig = Buffer.from(signature, 'hex')
    return crypto.subtle.verify('Ed25519', key, sig, message)
  } catch {
    return false
  }
}
