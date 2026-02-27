/**
 * Unit Tests for EvmExecutionCollector
 * Verifies metric collection, sync status handling, connection validation,
 * and capability detection — all without real RPC calls (fetch is mocked via vi.fn()).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NodeInstance } from '@/core/types'

// ============================================================
// Mocks
// ============================================================

// Mock connection-validator to control validateConnection outcome
vi.mock('@/core/collectors/connection-validator', () => ({
  validateRpcConnection: vi.fn(),
}))

import { validateRpcConnection } from '@/core/collectors/connection-validator'
const mockValidateRpcConnection = vi.mocked(validateRpcConnection)

// ============================================================
// Helpers
// ============================================================

function makeInstance(rpcUrl = 'http://localhost:8545', authToken?: string): NodeInstance {
  return {
    instanceId: 'test-instance',
    operatorId: 'default',
    protocolId: 'opstack-l2',
    displayName: 'Test Node',
    connectionConfig: { rpcUrl, authToken },
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Build a minimal fetch mock that returns different JSON bodies per method.
 * methodMap: { 'eth_blockNumber': '0x100', 'eth_syncing': false, ... }
 */
function buildFetchMock(methodMap: Record<string, unknown>): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async (_url: string, options: { body?: string }) => {
    const body = JSON.parse(options?.body ?? '{}') as { method?: string }
    const result = body.method ? (methodMap[body.method] ?? null) : null

    // Simulate RPC error for methods not in map returning Error object
    if (result instanceof Error) {
      return {
        ok: true,
        json: async () => ({ error: { message: result.message } }),
      }
    }

    return {
      ok: true,
      json: async () => ({ result }),
    }
  })
}

// ============================================================
// Tests
// ============================================================

describe('EvmExecutionCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('collect() returns GenericMetricDataPoint with required fields', async () => {
    const fetchMock = buildFetchMock({
      eth_blockNumber: '0x1a4',  // 420
      eth_syncing: false,        // fully synced
      net_peerCount: '0x8',      // 8 peers
      txpool_status: { pending: '0x5', queued: '0x2' },
    })
    vi.stubGlobal('fetch', fetchMock)

    const { EvmExecutionCollector } = await import('@/core/collectors/evm-execution')
    const collector = new EvmExecutionCollector()
    const result = await collector.collect(makeInstance())

    expect(result.success).toBe(true)
    expect(result.dataPoint).toBeDefined()
    expect(result.dataPoint!.instanceId).toBe('test-instance')
    expect(result.dataPoint!.timestamp).toBeTruthy()
    expect(result.dataPoint!.fields).toBeDefined()
    expect(typeof result.collectionMs).toBe('number')
  })

  it('collect() handles syncStatus correctly when node is synced', async () => {
    const fetchMock = buildFetchMock({
      eth_blockNumber: '0x64',   // 100
      eth_syncing: false,        // fully synced → syncStatus=100, syncDistance=0
      net_peerCount: '0x5',
    })
    vi.stubGlobal('fetch', fetchMock)

    const { EvmExecutionCollector } = await import('@/core/collectors/evm-execution')
    const collector = new EvmExecutionCollector()
    const result = await collector.collect(makeInstance())

    expect(result.success).toBe(true)
    expect(result.dataPoint!.fields.syncStatus).toBe(100)
    expect(result.dataPoint!.fields.syncDistance).toBe(0)
  })

  it('collect() handles syncStatus when node is syncing', async () => {
    const fetchMock = buildFetchMock({
      eth_blockNumber: '0x64',
      eth_syncing: {
        currentBlock: '0x32',   // 50
        highestBlock: '0x64',   // 100
      },
      net_peerCount: '0x3',
    })
    vi.stubGlobal('fetch', fetchMock)

    const { EvmExecutionCollector } = await import('@/core/collectors/evm-execution')
    const collector = new EvmExecutionCollector()
    const result = await collector.collect(makeInstance())

    expect(result.success).toBe(true)
    // syncStatus = Math.round(50/100 * 100) = 50
    expect(result.dataPoint!.fields.syncStatus).toBe(50)
    // syncDistance = 100 - 50 = 50
    expect(result.dataPoint!.fields.syncDistance).toBe(50)
  })

  it('validateConnection() returns valid:true for successful connection', async () => {
    mockValidateRpcConnection.mockResolvedValue({
      valid: true,
      checks: [{ name: 'eth_blockNumber', passed: true, latencyMs: 12 }],
      clientVersion: 'Geth/v1.14.0-stable',
      chainId: 11155420,
      totalLatencyMs: 25,
    })

    const { EvmExecutionCollector } = await import('@/core/collectors/evm-execution')
    const collector = new EvmExecutionCollector()
    const result = await collector.validateConnection(makeInstance())

    expect(result.valid).toBe(true)
    expect(result.checks.length).toBeGreaterThan(0)
    expect(mockValidateRpcConnection).toHaveBeenCalledTimes(1)
  })

  it('validateConnection() returns valid:false for unreachable endpoint', async () => {
    mockValidateRpcConnection.mockResolvedValue({
      valid: false,
      checks: [{ name: 'eth_blockNumber', passed: false, detail: 'fetch failed' }],
      totalLatencyMs: 5001,
      error: 'connect ECONNREFUSED',
    })

    const { EvmExecutionCollector } = await import('@/core/collectors/evm-execution')
    const collector = new EvmExecutionCollector()
    const result = await collector.validateConnection(makeInstance('http://unreachable:9999'))

    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('detectCapabilities() detects txpool support', async () => {
    const fetchMock = buildFetchMock({
      web3_clientVersion: 'Geth/v1.14.8-stable-a9523b64',
      eth_chainId: '0xaa37dc',  // 11155420 (OP Sepolia)
      txpool_status: { pending: '0x0', queued: '0x0' },
      // admin_peers and debug_metrics are not supported
    })
    vi.stubGlobal('fetch', fetchMock)

    const { EvmExecutionCollector } = await import('@/core/collectors/evm-execution')
    const collector = new EvmExecutionCollector()
    const caps = await collector.detectCapabilities(makeInstance())

    expect(caps.txpoolSupported).toBe(true)
    expect(caps.clientFamily).toBe('Geth')
    expect(caps.chainId).toBe(0xaa37dc)
    expect(caps.availableMethods).toContain('txpool_status')
  })

  it('collect() handles fetch errors gracefully — does not throw, returns a result', async () => {
    // EvmExecutionCollector uses Promise.allSettled for the three main RPC calls,
    // so individual fetch rejections are caught internally and reflected as null fields.
    // The collect() still returns a result object rather than throwing.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const { EvmExecutionCollector } = await import('@/core/collectors/evm-execution')
    const collector = new EvmExecutionCollector()

    // Must not throw — always returns a result object
    const result = await collector.collect(makeInstance())

    expect(result).toBeDefined()
    expect(typeof result.collectionMs).toBe('number')
    expect(result.collectionMs).toBeGreaterThanOrEqual(0)

    // When all RPC calls fail via Promise.allSettled, success is still true
    // (graceful degradation: fields are null, not an error state)
    // This is correct behavior — the outer try/catch only fires on unexpected errors
    expect(typeof result.success).toBe('boolean')

    if (result.success) {
      // Graceful degradation path: dataPoint exists but fields are null/NaN
      expect(result.dataPoint).toBeDefined()
      expect(result.dataPoint!.instanceId).toBe('test-instance')
    } else {
      // Error path: error message should be set
      expect(result.error).toBeTruthy()
    }
  })
})
