/**
 * Predictive Scaling Types
 * AI-based preemptive scaling with time-series analysis
 */

import { TargetVcpu } from './scaling';

/**
 * Single metric data point for time-series analysis
 * Collected every minute, stored in ring buffer (max 60 points)
 */
export interface MetricDataPoint {
  /** ISO 8601 timestamp when metric was collected */
  timestamp: string;

  /** CPU usage percentage (0-100) */
  cpuUsage: number;

  /** Number of pending transactions in txpool */
  txPoolPending: number;

  /** Gas used ratio (0-1), derived from gasUsed/gasLimit */
  gasUsedRatio: number;

  /** L2 block height at collection time */
  blockHeight: number;

  /** Block production interval in seconds (time since last block) */
  blockInterval: number;

  /** Current vCPU allocation */
  currentVcpu: number;
}

/**
 * AI prediction result for future scaling needs
 */
export interface PredictionResult {
  /** Predicted target vCPU for next 5 minutes */
  predictedVcpu: TargetVcpu;

  /** Confidence score (0-1), must be > 0.7 to trigger preemptive scaling */
  confidence: number;

  /** Detected trend direction */
  trend: 'rising' | 'falling' | 'stable';

  /** Natural language explanation of the prediction */
  reasoning: string;

  /** Recommended action based on prediction */
  recommendedAction: 'scale_up' | 'scale_down' | 'maintain';

  /** ISO 8601 timestamp of prediction generation */
  generatedAt: string;

  /** Time window the prediction covers (e.g., "next 5 minutes") */
  predictionWindow: string;

  /** Key factors that influenced this prediction */
  factors: PredictionFactor[];
}

/**
 * Individual factor contributing to the prediction
 */
export interface PredictionFactor {
  /** Factor name (e.g., "cpuTrend", "txPoolSpike") */
  name: string;

  /** Impact score (-1 to 1, negative = scale down, positive = scale up) */
  impact: number;

  /** Human-readable description */
  description: string;
}

/**
 * Record for tracking prediction accuracy
 */
export interface PredictionRecord {
  /** Unique ID for this prediction */
  id: string;

  /** The prediction that was made */
  prediction: PredictionResult;

  /** Actual vCPU that was needed (filled in later) */
  actualVcpu?: TargetVcpu;

  /** Whether prediction was accurate (within 1 vCPU) */
  wasAccurate?: boolean;

  /** Timestamp when actual outcome was recorded */
  verifiedAt?: string;
}

/**
 * Statistics about the metrics store
 */
export interface MetricsStoreStats {
  /** Number of data points currently stored */
  count: number;

  /** Timestamp of oldest data point */
  oldestTimestamp: string | null;

  /** Timestamp of newest data point */
  newestTimestamp: string | null;

  /** Statistical summaries */
  stats: {
    cpu: MetricStatSummary;
    txPool: MetricStatSummary;
    gasUsedRatio: MetricStatSummary;
    blockInterval: MetricStatSummary;
  };
}

/**
 * Statistical summary for a single metric
 */
export interface MetricStatSummary {
  /** Arithmetic mean */
  mean: number;

  /** Standard deviation */
  stdDev: number;

  /** Minimum value in the window */
  min: number;

  /** Maximum value in the window */
  max: number;

  /** Detected trend using linear regression slope */
  trend: 'rising' | 'falling' | 'stable';

  /** Slope value from linear regression (positive = rising) */
  slope: number;
}

/**
 * Configuration for prediction behavior
 */
export interface PredictionConfig {
  /** Minimum confidence to trigger preemptive scaling (default: 0.7) */
  confidenceThreshold: number;

  /** Minimum data points required before making predictions (default: 10) */
  minDataPoints: number;

  /** Rate limit: minimum seconds between predictions (default: 300 = 5 min) */
  predictionCooldownSeconds: number;

  /** How far ahead to predict in minutes (default: 5) */
  predictionWindowMinutes: number;
}

/**
 * Default prediction configuration
 */
export const DEFAULT_PREDICTION_CONFIG: PredictionConfig = {
  confidenceThreshold: 0.7,
  minDataPoints: 10,
  predictionCooldownSeconds: 300,
  predictionWindowMinutes: 5,
};
