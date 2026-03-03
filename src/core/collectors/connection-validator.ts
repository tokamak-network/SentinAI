/**
 * Connection Validator
 * Tests RPC accessibility and detects client version.
 * Used by all collector types.
 */
import type { ConnectionConfig, ConnectionValidationResult, ConnectionCheck } from '@/core/types'

const DEFAULT_TIMEOUT_MS = parseInt(process.env.CONN_VALIDATE_TIMEOUT_MS || '8000', 10)

async function rpcCall(
  url: string,
  method: string,
  params: unknown[] = [],
  authToken?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { result?: unknown; error?: { message: string } }
    if (data.error) throw new Error(data.error.message)
    return data.result
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

export async function validateRpcConnection(config: ConnectionConfig): Promise<ConnectionValidationResult> {
  const start = Date.now()
  const checks: ConnectionCheck[] = []
  let clientVersion: string | undefined
  let chainId: number | undefined

  // Check 1: Basic connectivity (eth_blockNumber)
  try {
    const blockNumberStart = Date.now()
    const result = await rpcCall(config.rpcUrl, 'eth_blockNumber', [], config.authToken)
    checks.push({
      name: 'eth_blockNumber',
      passed: typeof result === 'string',
      latencyMs: Date.now() - blockNumberStart,
    })
  } catch (err) {
    checks.push({ name: 'eth_blockNumber', passed: false, detail: String(err) })
    return { valid: false, checks, totalLatencyMs: Date.now() - start, error: String(err) }
  }

  // Check 2: Client version (web3_clientVersion)
  try {
    const versionResult = await rpcCall(config.rpcUrl, 'web3_clientVersion', [], config.authToken)
    clientVersion = typeof versionResult === 'string' ? versionResult : undefined
    checks.push({ name: 'web3_clientVersion', passed: !!clientVersion, detail: clientVersion })
  } catch {
    checks.push({ name: 'web3_clientVersion', passed: false, detail: 'not supported' })
  }

  // Check 3: Chain ID
  try {
    const chainIdResult = await rpcCall(config.rpcUrl, 'eth_chainId', [], config.authToken)
    chainId = typeof chainIdResult === 'string' ? parseInt(chainIdResult, 16) : undefined
    checks.push({ name: 'eth_chainId', passed: chainId !== undefined })
  } catch {
    checks.push({ name: 'eth_chainId', passed: false })
  }

  return {
    valid: true,
    checks,
    clientVersion,
    chainId,
    totalLatencyMs: Date.now() - start,
  }
}

export async function validateBeaconConnection(config: ConnectionConfig): Promise<ConnectionValidationResult> {
  const baseUrl = config.beaconApiUrl ?? config.rpcUrl
  const start = Date.now()
  const checks: ConnectionCheck[] = []
  let clientVersion: string | undefined

  // Check 1: Syncing status
  try {
    const t = Date.now()
    const res = await fetch(`${baseUrl}/eth/v1/node/syncing`)
    const data = await res.json() as { data?: { head_slot?: string } }
    checks.push({
      name: '/eth/v1/node/syncing',
      passed: !!data.data?.head_slot,
      latencyMs: Date.now() - t,
    })
  } catch (err) {
    checks.push({ name: '/eth/v1/node/syncing', passed: false, detail: String(err) })
    return { valid: false, checks, totalLatencyMs: Date.now() - start, error: String(err) }
  }

  // Check 2: Client version
  try {
    const res = await fetch(`${baseUrl}/eth/v1/node/version`)
    const data = await res.json() as { data?: { version?: string } }
    clientVersion = data.data?.version
    checks.push({ name: '/eth/v1/node/version', passed: !!clientVersion, detail: clientVersion })
  } catch {
    checks.push({ name: '/eth/v1/node/version', passed: false })
  }

  return { valid: true, checks, clientVersion, totalLatencyMs: Date.now() - start }
}
