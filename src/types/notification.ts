export type NotificationChannel = 'slack' | 'discord' | 'telegram' | 'dashboard'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface ApprovalRequest {
  actionId: string
  /** Short-lived HMAC token for callback verification */
  token: string
  description: string
  riskLevel: RiskLevel
  /** ISO 8601 */
  expiresAt: string
  chainId?: string
  /** Additional context to display */
  details?: Record<string, string>
}

export interface NotificationResult {
  channel: NotificationChannel
  success: boolean
  /** Platform-specific message ID (for later editing) */
  messageId?: string
  error?: string
}

export interface ApprovalOutcome {
  actionId: string
  channel: NotificationChannel
  approved: boolean
  approvedBy?: string
  /** ISO 8601 */
  decidedAt: string
}
