/**
 * Anomaly Detection Pipeline Types
 * Type definitions for multi-layer anomaly detection system
 */

import { AISeverity } from './scaling';

// ============================================================================
// Layer 1: Statistical Anomaly Detection
// ============================================================================

/**
 * Anomaly direction
 * - spike: sudden increase
 * - drop: sudden decrease
 * - plateau: no change for extended period (stagnation)
 */
export type AnomalyDirection = 'spike' | 'drop' | 'plateau';

/**
 * Detection target metrics
 */
export type AnomalyMetric =
  | 'cpuUsage'
  | 'txPoolPending'
  | 'gasUsedRatio'
  | 'l2BlockHeight'
  | 'l2BlockInterval';

/**
 * Layer 1 statistical anomaly detection result
 */
export interface AnomalyResult {
  /** Whether anomaly is detected */
  isAnomaly: boolean;
  /** Metric where anomaly was detected */
  metric: AnomalyMetric;
  /** Current value */
  value: number;
  /** Z-Score (distance from mean in standard deviation units) */
  zScore: number;
  /** Anomaly direction */
  direction: AnomalyDirection;
  /** Human-readable description */
  description: string;
  /** Detection rule that triggered */
  rule: 'z-score' | 'zero-drop' | 'plateau' | 'monotonic-increase';
}

// ============================================================================
// Layer 2: AI Semantic Analysis
// ============================================================================

/**
 * Anomaly type classification
 */
export type AnomalyType = 'performance' | 'security' | 'consensus' | 'liveness';

/**
 * Layer 2 AI deep analysis result
 */
export interface DeepAnalysisResult {
  /** AI-assessed severity */
  severity: AISeverity;
  /** Anomaly type */
  anomalyType: AnomalyType;
  /** Correlated metrics/log patterns */
  correlations: string[];
  /** Predicted impact */
  predictedImpact: string;
  /** Suggested actions */
  suggestedActions: string[];
  /** Affected components */
  relatedComponents: string[];
  /** Analysis timestamp */
  timestamp: string;
  /** Raw AI model response (for debugging) */
  rawResponse?: string;
}

// ============================================================================
// Layer 3: Alert Dispatch
// ============================================================================

/**
 * Alert channel type
 */
export type AlertChannel = 'slack' | 'webhook' | 'dashboard';

/**
 * Alert configuration
 */
export interface AlertConfig {
  /** Slack/Discord webhook URL (optional) */
  webhookUrl?: string;
  /** Alert threshold settings */
  thresholds: {
    /** Notify at this severity level and above */
    notifyOn: AISeverity[];
    /** Cooldown interval for same anomaly type (minutes) */
    cooldownMinutes: number;
  };
  /** Whether alerting is enabled */
  enabled: boolean;
}

/**
 * Dispatched alert record
 */
export interface AlertRecord {
  /** Unique ID */
  id: string;
  /** Source anomaly detection result */
  anomaly: AnomalyResult;
  /** AI deep analysis result (if available) */
  analysis?: DeepAnalysisResult;
  /** Dispatch timestamp */
  sentAt: string;
  /** Dispatch channel */
  channel: AlertChannel;
  /** Whether dispatch succeeded */
  success: boolean;
  /** Error message on failure */
  error?: string;
}

// ============================================================================
// Anomaly Event (Unified)
// ============================================================================

/**
 * Anomaly event status
 */
export type AnomalyEventStatus = 'active' | 'resolved' | 'acknowledged';

/**
 * Anomaly event (unified Layer 1~3 results)
 */
export interface AnomalyEvent {
  /** Unique ID (UUID v4) */
  id: string;
  /** First detection time (Unix timestamp ms) */
  timestamp: number;
  /** Layer 1 detected anomalies */
  anomalies: AnomalyResult[];
  /** Layer 2 AI deep analysis result (if performed) */
  deepAnalysis?: DeepAnalysisResult;
  /** Event status */
  status: AnomalyEventStatus;
  /** Resolution time (if resolved) */
  resolvedAt?: number;
  /** Dispatched alert records */
  alerts: AlertRecord[];
}

// ============================================================================
// API Types
// ============================================================================

/**
 * GET /api/anomalies response
 */
export interface AnomaliesResponse {
  /** Anomaly events (newest first) */
  events: AnomalyEvent[];
  /** Total event count */
  total: number;
  /** Currently active anomaly count */
  activeCount: number;
}

/**
 * GET /api/anomalies/config response
 */
export interface AlertConfigResponse {
  config: AlertConfig;
  /** Alerts sent in last 24 hours */
  alertsSent24h: number;
  /** Next available alert time (when in cooldown) */
  nextAlertAvailableAt?: string;
}

/**
 * POST /api/anomalies/config request body
 */
export interface AlertConfigUpdateRequest {
  webhookUrl?: string;
  thresholds?: {
    notifyOn?: AISeverity[];
    cooldownMinutes?: number;
  };
  enabled?: boolean;
}

/**
 * Metrics API extension - anomalies field
 */
export interface MetricsAnomalyExtension {
  /** Layer 1 anomaly detection results (real-time) */
  anomalies: AnomalyResult[];
  /** Currently active anomaly event ID (if any) */
  activeEventId?: string;
}
