/**
 * MCP Auth — JWT-based operator token issuance
 * Provides scoped tokens for MCP tool execution.
 *
 * Env: SENTINAI_JWT_SECRET (required for production)
 *      SENTINAI_TIER (general | premium | enterprise)
 */

import { createHmac, randomBytes } from 'crypto'
import { createLogger } from '@/lib/logger'

const logger = createLogger('mcp-auth')

export interface OperatorTokenPayload {
  sub: string           // operatorId
  chainId?: string      // scoped chain (undefined = all chains)
  tier: string          // subscription tier
  iat: number           // issued at (Unix seconds)
  exp: number           // expiry (Unix seconds)
  jti: string           // unique token ID (for revocation)
}

export interface IssueTokenOptions {
  operatorId: string
  chainId?: string
  ttlSeconds?: number   // default: 3600 (1 hour)
}

export interface TokenValidationResult {
  valid: boolean
  payload?: OperatorTokenPayload
  error?: string
}

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

function base64urlEncode(data: string | Buffer): string {
  const b64 = Buffer.isBuffer(data)
    ? data.toString('base64')
    : Buffer.from(data).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlDecode(str: string): Buffer {
  const padded = str
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(str.length + (4 - (str.length % 4)) % 4, '=')
  return Buffer.from(padded, 'base64')
}

// ---------------------------------------------------------------------------
// Secret resolution
// ---------------------------------------------------------------------------

let _cachedSecret: string | null = null

function getSecret(): string {
  if (_cachedSecret) return _cachedSecret

  const fromEnv = process.env.SENTINAI_JWT_SECRET
  if (fromEnv) {
    _cachedSecret = fromEnv
    return _cachedSecret
  }

  const fallback = process.env.SENTINAI_API_KEY
  if (fallback) {
    logger.warn('[mcp-auth] SENTINAI_JWT_SECRET not set — falling back to SENTINAI_API_KEY')
    _cachedSecret = fallback
    return _cachedSecret
  }

  // Last resort: random secret (tokens will not survive restarts)
  const random = randomBytes(32).toString('hex')
  logger.warn('[mcp-auth] SENTINAI_JWT_SECRET not set — using ephemeral random secret (tokens are restart-scoped)')
  _cachedSecret = random
  return _cachedSecret
}

// ---------------------------------------------------------------------------
// JWT header
// ---------------------------------------------------------------------------

const JWT_HEADER = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Issues a signed operator token.
 */
export function issueOperatorToken(options: IssueTokenOptions): string {
  const { operatorId, chainId, ttlSeconds = 3600 } = options

  const now = Math.floor(Date.now() / 1000)
  const payload: OperatorTokenPayload = {
    sub: operatorId,
    tier: process.env.SENTINAI_TIER ?? 'general',
    iat: now,
    exp: now + ttlSeconds,
    jti: randomBytes(16).toString('hex'),
    ...(chainId !== undefined ? { chainId } : {}),
  }

  const encodedPayload = base64urlEncode(JSON.stringify(payload))
  const signingInput = `${JWT_HEADER}.${encodedPayload}`
  const secret = getSecret()

  const signature = base64urlEncode(
    createHmac('sha256', secret).update(signingInput).digest(),
  )

  const token = `${signingInput}.${signature}`
  logger.debug(`[mcp-auth] issued token for operator=${operatorId} tier=${payload.tier} exp=${payload.exp}`)
  return token
}

/**
 * Validates a signed operator token.
 */
export function validateOperatorToken(token: string): TokenValidationResult {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token: expected 3 segments' }
  }

  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string]

  // Verify signature
  const secret = getSecret()
  const signingInput = `${headerPart}.${payloadPart}`
  const expectedSig = base64urlEncode(
    createHmac('sha256', secret).update(signingInput).digest(),
  )

  if (signaturePart !== expectedSig) {
    return { valid: false, error: 'Invalid signature' }
  }

  // Decode payload
  let payload: OperatorTokenPayload
  try {
    const decoded = base64urlDecode(payloadPart).toString('utf8')
    payload = JSON.parse(decoded) as OperatorTokenPayload
  } catch {
    return { valid: false, error: 'Failed to decode payload' }
  }

  // Check expiry
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp <= now) {
    return { valid: false, error: `Token expired at ${new Date(payload.exp * 1000).toISOString()}` }
  }

  return { valid: true, payload }
}

/** Write-capable tiers */
const WRITE_TIERS = new Set(['premium', 'enterprise'])

/**
 * Checks whether a token grants access to the requested chainId.
 * Write operations require premium/enterprise tier.
 */
export function checkMcpScope(
  token: string,
  requiredChainId?: string,
): { allowed: boolean; reason?: string } {
  const result = validateOperatorToken(token)
  if (!result.valid || !result.payload) {
    return { allowed: false, reason: result.error ?? 'Invalid token' }
  }

  const { payload } = result

  // Tier check for write operations
  if (!WRITE_TIERS.has(payload.tier)) {
    return {
      allowed: false,
      reason: `Tier '${payload.tier}' does not permit write operations (requires premium or enterprise)`,
    }
  }

  // Chain scope check
  if (requiredChainId !== undefined && payload.chainId !== undefined) {
    if (payload.chainId !== requiredChainId) {
      return {
        allowed: false,
        reason: `Token scoped to chain '${payload.chainId}', but '${requiredChainId}' was required`,
      }
    }
  }

  return { allowed: true }
}

/** Reset cached secret (for testing only) */
export function _resetSecretForTest(): void {
  _cachedSecret = null
}
