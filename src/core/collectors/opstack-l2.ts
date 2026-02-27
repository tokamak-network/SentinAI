/**
 * OP Stack L2 Collector
 * Extracts L2 metrics from the sequencer node.
 * Based on the existing agent-loop.ts collectMetrics() logic.
 */
import type { MetricsCollector, DetectedCapabilities } from './types'
import type { NodeInstance, ConnectionValidationResult } from '@/core/types'
import type { CollectorResult, GenericMetricDataPoint } from '@/core/metrics'
import { validateRpcConnection } from './connection-validator'

const RPC_TIMEOUT_MS = 15000

async function rpcFetch(url: string, method: string, params: unknown[] = [], authToken?: string): Promise<unknown> {
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

export class OpStackL2Collector implements MetricsCollector {
  async collect(instance: NodeInstance): Promise<CollectorResult> {
    const start = Date.now()
    const { rpcUrl, authToken } = instance.connectionConfig

    try {
      // L2 block
      const blockResult = await rpcFetch(rpcUrl, 'eth_getBlockByNumber', ['latest', false], authToken) as {
        number?: string; gasUsed?: string; gasLimit?: string; transactions?: unknown[]
      } | null

      const blockHeight = blockResult?.number ? parseInt(blockResult.number, 16) : null
      const gasUsed = blockResult?.gasUsed ? parseInt(blockResult.gasUsed, 16) : 0
      const gasLimit = blockResult?.gasLimit ? parseInt(blockResult.gasLimit, 16) : 1
      const gasUsedRatio = gasLimit > 0 ? gasUsed / gasLimit : 0

      // TxPool
      let txPoolPending: number | null = null
      let txPoolQueued: number | null = null
      try {
        const txpool = await rpcFetch(rpcUrl, 'txpool_status', [], authToken) as { pending?: string; queued?: string }
        txPoolPending = txpool?.pending ? parseInt(txpool.pending, 16) : (blockResult?.transactions?.length ?? 0)
        txPoolQueued = txpool?.queued ? parseInt(txpool.queued, 16) : 0
      } catch {
        txPoolPending = blockResult?.transactions?.length ?? null
      }

      // Peer count
      let peerCount: number | null = null
      try {
        const peers = await rpcFetch(rpcUrl, 'net_peerCount', [], authToken) as string
        peerCount = parseInt(peers, 16)
      } catch { /* not critical */ }

      const dataPoint: GenericMetricDataPoint = {
        instanceId: instance.instanceId,
        timestamp: new Date().toISOString(),
        fields: {
          blockHeight,
          txPoolPending,
          txPoolQueued,
          peerCount,
          gasUsedRatio,
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
    let clientVersion = 'unknown'
    let clientFamily = 'op-geth'
    let chainId = 0

    try {
      const v = await rpcFetch(rpcUrl, 'web3_clientVersion', [], authToken) as string
      clientVersion = v ?? 'unknown'
      const match = clientVersion.match(/^([^/]+)/)
      clientFamily = match?.[1] ?? 'op-geth'
    } catch { /* ignore */ }

    try {
      const cid = await rpcFetch(rpcUrl, 'eth_chainId', [], authToken) as string
      chainId = parseInt(cid, 16)
    } catch { /* ignore */ }

    return {
      clientFamily,
      clientVersion,
      chainId,
      availableMethods: ['eth_blockNumber', 'eth_getBlockByNumber', 'txpool_status'],
      txpoolSupported: true,
      adminPeersSupported: false,
      debugMetricsSupported: false,
    }
  }
}

export const opStackL2Collector = new OpStackL2Collector()
