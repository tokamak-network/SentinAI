/**
 * SentinAI Core Metrics Types
 * Generic metric data structures for multi-protocol node monitoring.
 *
 * Decoupled from any specific chain or protocol — all protocol-specific
 * field definitions live in ProtocolDescriptor.metricsFields.
 */

// ============================================================
// Metric Field Definition
// ============================================================

/**
 * Unit of measurement for a metric field.
 * Used for display formatting and threshold comparison.
 */
export type MetricUnit =
  | 'count'     // Raw integer count (blocks, txs, peers)
  | 'percent'   // 0–100 percentage (CPU, gas ratio * 100)
  | 'ratio'     // 0.0–1.0 fraction (gasUsed/gasLimit)
  | 'bytes'     // Raw bytes (memory usage)
  | 'seconds'   // Duration in seconds (sync lag, latency)
  | 'ms'        // Duration in milliseconds
  | 'eth'       // ETH balance
  | 'gwei'      // Gas price in gwei
  | 'slot'      // Beacon chain slot number
  | 'epoch';    // Beacon chain epoch number

/**
 * Definition of a single collectible metric field for a protocol.
 * Registered in ProtocolDescriptor.metricsFields.
 *
 * Example:
 * ```typescript
 * {
 *   fieldName: 'peerCount',
 *   displayName: '피어 수',
 *   unit: 'count',
 *   description: '현재 연결된 P2P 피어 수',
 *   isKeyMetric: true,
 *   anomalyHint: { method: 'threshold', criticalThreshold: 3 }
 * }
 * ```
 */
export interface MetricFieldDefinition {
  /**
   * Canonical field name used as key in GenericMetricDataPoint.fields.
   * camelCase, e.g., 'blockHeight', 'peerCount', 'txPoolPending'
   */
  fieldName: string;
  /** Human-readable display name (한글 가능) */
  displayName: string;
  /** Unit of measurement */
  unit: MetricUnit;
  /** Optional description for documentation and UI tooltips */
  description?: string;
  /**
   * Whether this is a primary health indicator displayed prominently.
   * Non-key metrics are collected but shown in secondary panels.
   */
  isKeyMetric?: boolean;
  /**
   * Hint for anomaly detection configuration.
   * Final config lives in ProtocolDescriptor.anomalyConfig — this is a default seed.
   */
  anomalyHint?: {
    method: 'z-score' | 'threshold' | 'rate-of-change' | 'plateau';
    criticalThreshold?: number;
    warningThreshold?: number;
  };
  /**
   * Whether null values are acceptable (vs. treated as collection failure).
   * Default: false
   */
  nullable?: boolean;
}

// ============================================================
// Generic Metric Data Point
// ============================================================

/**
 * A single metric collection result for one node instance at one timestamp.
 *
 * All numeric values in `fields` correspond to MetricFieldDefinition.fieldName keys.
 * Null means the field was not available in this collection cycle
 * (e.g., API not supported, endpoint unreachable).
 *
 * Stored in Redis ring buffer:
 *   Key: `inst:{instanceId}:metrics:buffer`
 *   Value: last 60 data points (LPUSH + LTRIM)
 */
export interface GenericMetricDataPoint {
  /** Instance this data point belongs to */
  instanceId: string;
  /** ISO 8601 collection timestamp */
  timestamp: string;
  /**
   * Metric values keyed by MetricFieldDefinition.fieldName.
   * null = not collected / unavailable this cycle.
   */
  fields: Record<string, number | null>;
  /**
   * Raw API responses for debugging and audit.
   * Not indexed or searched — JSON blob for human inspection.
   */
  raw?: Record<string, unknown>;
  /** Whether this data point came from a simulated/seeded source */
  simulated?: boolean;
}

// ============================================================
// Metric Statistics
// ============================================================

/**
 * Running statistics over a window of GenericMetricDataPoint values
 * for a single field. Computed by InstanceMetricsStore.
 */
export interface MetricFieldStats {
  fieldName: string;
  /** Most recent value */
  current: number | null;
  /** Minimum over the window */
  min: number;
  /** Maximum over the window */
  max: number;
  /** Arithmetic mean */
  mean: number;
  /** Standard deviation (for Z-Score anomaly detection) */
  stdDev: number;
  /**
   * Linear regression slope (positive = rising, negative = falling).
   * Units: value-per-cycle
   */
  trend: number;
  /** Number of data points in the window */
  windowSize: number;
}

/**
 * Aggregated statistics for all fields of one instance over a time window.
 * Returned by InstanceMetricsStore.getStats().
 */
export interface InstanceMetricsStats {
  instanceId: string;
  /** Timestamp of the most recent data point */
  lastUpdatedAt: string;
  /** Per-field statistics */
  fields: Record<string, MetricFieldStats>;
}

// ============================================================
// Collector Result
// ============================================================

/**
 * Return type from MetricsCollector.collect().
 * Wraps GenericMetricDataPoint with collection metadata.
 */
export interface CollectorResult {
  success: boolean;
  dataPoint?: GenericMetricDataPoint;
  /** Milliseconds taken to collect */
  collectionMs: number;
  /** Error if collection failed */
  error?: string;
}
