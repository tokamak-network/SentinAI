/**
 * Daily Report Type Definitions
 */

// ============================================================
// Metric Snapshot (5-minute intervals)
// ============================================================

/** Metric statistics snapshot from ring buffer at 5-minute intervals */
export interface MetricSnapshot {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Number of ring buffer data points at snapshot time (0-60) */
  dataPointCount: number;
  cpu: { mean: number; min: number; max: number; stdDev: number };
  txPool: { mean: number; min: number; max: number; stdDev: number };
  gasUsedRatio: { mean: number; min: number; max: number; stdDev: number };
  blockInterval: { mean: number; min: number; max: number; stdDev: number };
  /** Latest L2 block height at snapshot time */
  latestBlockHeight: number;
  /** vCPU setting at snapshot time */
  currentVcpu: number;
}

// ============================================================
// Hourly Summary
// ============================================================

/** Hourly aggregated summary (for AI prompt) */
export interface HourlySummary {
  /** Hour (0-23) */
  hour: number;
  /** Number of snapshots in this hour (max 12) */
  snapshotCount: number;
  avgCpu: number;
  maxCpu: number;
  avgTxPool: number;
  maxTxPool: number;
  avgGasRatio: number;
  avgBlockInterval: number;
  /** Estimated number of blocks produced in this hour */
  blocksProduced: number;
  /** vCPU change history */
  vcpuChanges: Array<{ timestamp: string; from: number; to: number }>;
}

// ============================================================
// Log Analysis & Scaling Events
// ============================================================

/** Log analysis result entry (collected from analyze-logs API) */
export interface LogAnalysisEntry {
  timestamp: string;
  severity: 'normal' | 'warning' | 'critical';
  summary: string;
  actionItem: string;
}

/** Scaling event (collected from scaler API) */
export interface ScalingEvent {
  timestamp: string;
  fromVcpu: number;
  toVcpu: number;
  trigger: 'auto' | 'manual' | 'predictive';
  reason: string;
}

// ============================================================
// AWS Cost Tracking
// ============================================================

/** AWS service cost (daily aggregate) */
export interface AWSServiceCost {
  service: 'EKS' | 'EC2' | 'NAT' | 'CloudWatch' | 'VPC' | 'RDS' | 'S3' | 'Other';
  dailyCost: number;
  monthlyCost: number;
  unit: string; // e.g., "vCPU-hour", "GB", "requests"
  usageAmount: number; // Daily usage amount
  description: string;
}

/** AWS daily cost summary */
export interface AWSDailyCost {
  date: string;
  dailyTotal: number;
  monthlyProjected: number;
  services: AWSServiceCost[];
  metadata: {
    currency: 'USD';
    region: 'ap-northeast-2'; // Seoul
    dataSource: 'CloudWatch' | 'Cost Explorer' | 'Manual Estimate';
    lastUpdated: string; // ISO 8601
  };
}

// ============================================================
// Daily Accumulated Data
// ============================================================

/** 24-hour accumulated data (input for report generation) */
export interface DailyAccumulatedData {
  /** Target date (YYYY-MM-DD) */
  date: string;
  /** Data collection start time (ISO 8601) */
  startTime: string;
  /** Last snapshot time (ISO 8601) */
  lastSnapshotTime: string;
  /** 5-minute interval snapshots (max 288) */
  snapshots: MetricSnapshot[];
  /** Hourly summaries (24) */
  hourlySummaries: HourlySummary[];
  /** Log analysis results */
  logAnalysisResults: LogAnalysisEntry[];
  /** Scaling events */
  scalingEvents: ScalingEvent[];
  /** AWS service costs */
  awsCost?: AWSDailyCost;
  /** Data quality metadata */
  metadata: {
    /** Actual collection rate vs expected (0-1) */
    dataCompleteness: number;
    /** Data collection gaps (server restarts, etc.) */
    dataGaps: Array<{ start: string; end: string; reason: string }>;
  };
}

// ============================================================
// Accumulator State (In-Memory Singleton)
// ============================================================

/** Accumulator internal state */
export interface AccumulatorState {
  currentDate: string;
  data: DailyAccumulatedData;
  lastSnapshotTimestamp: number;
  startedAt: string;
}

// ============================================================
// API Types
// ============================================================

/** POST /api/reports/daily request body */
export interface DailyReportRequest {
  /** Target date (defaults to today if omitted) */
  date?: string;
  /** Overwrite existing report */
  force?: boolean;
  /** Include debug info (prompt, token count) */
  debug?: boolean;
}

/** POST /api/reports/daily response */
export interface DailyReportResponse {
  success: boolean;
  /** Generated report file path */
  reportPath?: string;
  /** Report markdown content */
  reportContent?: string;
  error?: string;
  /** Debug info */
  debug?: {
    promptTokens: number;
    completionTokens: number;
    systemPrompt: string;
    userPrompt: string;
  };
  /** Fallback report info (when AI provider fails) */
  fallback?: {
    enabled: boolean;
    reason: string;
  };
  metadata: {
    date: string;
    generatedAt: string;
    dataCompleteness: number;
    snapshotCount: number;
    processingTimeMs: number;
    aiModel?: string;
  };
}
