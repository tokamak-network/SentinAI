/**
 * EVM Execution Layer Collector
 * Supports: Geth, Reth, Nethermind, Besu
 * Collects: blockHeight, peerCount, syncStatus, txPoolPending, txPoolQueued
 */
import type { MetricsCollector, DetectedCapabilities } from './types'
import type { NodeInstance, ConnectionValidationResult } from '@/core/types'
import type { CollectorResult, GenericMetricDataPoint } from '@/core/metrics'
import { validateRpcConnection } from './connection-validator'

const RPC_TIMEOUT_MS = 10000

async function rpcCall(
  url: string,
  method: string,
  params: unknown[] = [],
  authToken?: string
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS)
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
    const data = await res.json() as { result?: unknown; error?: { message: string } }
    if (data.error) throw new Error(data.error.message)
    return data.result
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

export class EvmExecutionCollector implements MetricsCollector {
  async collect(instance: NodeInstance): Promise<CollectorResult> {
    const start = Date.now()
    const { rpcUrl, authToken } = instance.connectionConfig

    try {
      // Collect in parallel where possible
      const [blockNumberResult, syncingResult, peerCountResult] = await Promise.allSettled([
        rpcCall(rpcUrl, 'eth_blockNumber', [], authToken),
        rpcCall(rpcUrl, 'eth_syncing', [], authToken),
        rpcCall(rpcUrl, 'net_peerCount', [], authToken),
      ])

      const blockHeight = blockNumberResult.status === 'fulfilled'
        ? parseInt(blockNumberResult.value as string, 16)
        : null

      const syncingData = syncingResult.status === 'fulfilled' ? syncingResult.value : null
      let syncStatus: number | null = null
      let syncDistance: number | null = null

      if (syncingData === false) {
        syncStatus = 100 // fully synced
        syncDistance = 0
      } else if (syncingData && typeof syncingData === 'object') {
        const s = syncingData as { currentBlock?: string; highestBlock?: string }
        const current = s.currentBlock ? parseInt(s.currentBlock, 16) : 0
        const highest = s.highestBlock ? parseInt(s.highestBlock, 16) : 0
        syncDistance = highest > current ? highest - current : 0
        syncStatus = highest > 0 ? Math.round((current / highest) * 100) : 0
      }

      const peerCount = peerCountResult.status === 'fulfilled'
        ? parseInt(peerCountResult.value as string, 16)
        : null

      // TxPool (optional — not all clients support)
      let txPoolPending: number | null = null
      let txPoolQueued: number | null = null
      try {
        const txpool = await rpcCall(rpcUrl, 'txpool_status', [], authToken) as { pending?: string; queued?: string }
        if (txpool) {
          txPoolPending = txpool.pending ? parseInt(txpool.pending, 16) : 0
          txPoolQueued = txpool.queued ? parseInt(txpool.queued, 16) : 0
        }
      } catch { /* txpool not supported — leave null */ }

      const dataPoint: GenericMetricDataPoint = {
        instanceId: instance.instanceId,
        timestamp: new Date().toISOString(),
        fields: {
          blockHeight,
          peerCount,
          syncStatus,
          syncDistance,
          txPoolPending,
          txPoolQueued,
        },
      }

      return { success: true, dataPoint, collectionMs: Date.now() - start }
    } catch (err) {
      return { success: false, collectionMs: Date.now() - start, error: String(err) }
    }
  }

  async validateConnection(instance: NodeInstance): Promise<ConnectionValidationResult> {
    return validateRpcConnection(instance.connectionConfig)
  }

  async detectCapabilities(instance: NodeInstance): Promise<DetectedCapabilities> {
    const { rpcUrl, authToken } = instance.connectionConfig

    let clientFamily = 'unknown'
    let clientVersion = 'unknown'
    let chainId = 0

    try {
      const v = await rpcCall(rpcUrl, 'web3_clientVersion', [], authToken) as string
      clientVersion = v ?? 'unknown'
      // Parse client family from version string: "Geth/v1.14..." → "Geth"
      const match = clientVersion.match(/^([^/]+)/)
      clientFamily = match?.[1] ?? 'unknown'
    } catch { /* ignore */ }

    try {
      const cid = await rpcCall(rpcUrl, 'eth_chainId', [], authToken) as string
      chainId = parseInt(cid, 16)
    } catch { /* ignore */ }

    const availableMethods: string[] = []
    const methodChecks = [
      ['txpool_status', 'txpoolSupported'],
      ['admin_peers', 'adminPeersSupported'],
      ['debug_metrics', 'debugMetricsSupported'],
    ]

    const results = await Promise.allSettled(
      methodChecks.map(([method]) => rpcCall(rpcUrl, method, [], authToken))
    )

    let txpoolSupported = false
    let adminPeersSupported = false
    let debugMetricsSupported = false

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        availableMethods.push(methodChecks[i][0])
        if (methodChecks[i][0] === 'txpool_status') txpoolSupported = true
        if (methodChecks[i][0] === 'admin_peers') adminPeersSupported = true
        if (methodChecks[i][0] === 'debug_metrics') debugMetricsSupported = true
      }
    })

    return { clientFamily, clientVersion, chainId, availableMethods, txpoolSupported, adminPeersSupported, debugMetricsSupported }
  }
}

export const evmExecutionCollector = new EvmExecutionCollector()
