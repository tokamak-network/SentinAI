/**
 * Metrics Collector Interface
 * One implementation per collectorType in ProtocolDescriptor.
 */
import type { NodeInstance, ConnectionValidationResult } from '@/core/types'
import type { GenericMetricDataPoint, CollectorResult } from '@/core/metrics'

export interface DetectedCapabilities {
  /** Detected client software (e.g., 'Geth', 'Reth', 'Lighthouse') */
  clientFamily: string
  /** Full version string (e.g., 'Geth/v1.14.8-stable') */
  clientVersion: string
  /** Detected chain ID */
  chainId: number
  /** Which optional RPC methods are available */
  availableMethods: string[]
  /** Whether txpool_status is supported */
  txpoolSupported: boolean
  /** Whether admin_peers is supported */
  adminPeersSupported: boolean
  /** Whether debug_metrics is supported (Geth-specific) */
  debugMetricsSupported: boolean
}

export interface MetricsCollector {
  /** Collect a single data point from the node */
  collect(instance: NodeInstance): Promise<CollectorResult>
  /** Test connectivity and detect client version */
  validateConnection(instance: NodeInstance): Promise<ConnectionValidationResult>
  /** Probe which optional RPC methods are available */
  detectCapabilities(instance: NodeInstance): Promise<DetectedCapabilities>
}

// Re-export for convenience
export type { GenericMetricDataPoint, CollectorResult }
