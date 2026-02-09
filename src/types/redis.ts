/**
 * Redis State Store Types
 * Strategy Pattern interface for Redis / InMemory dual implementation
 */

import { MetricDataPoint } from './prediction';
import { ScalingState, ScalingHistoryEntry, SimulationConfig } from './scaling';
import { PredictionResult } from './prediction';

// ============================================================
// Store Interface
// ============================================================

/**
 * Unified state store interface
 * Implemented by RedisStateStore (production) and InMemoryStateStore (development)
 */
export interface IStateStore {
  // --- Metrics Buffer (Ring Buffer, max 60) ---
  pushMetric(dataPoint: MetricDataPoint): Promise<void>;
  getRecentMetrics(count?: number): Promise<MetricDataPoint[]>;
  clearMetrics(): Promise<void>;
  getMetricsCount(): Promise<number>;

  // --- Scaling State ---
  getScalingState(): Promise<ScalingState>;
  updateScalingState(updates: Partial<ScalingState>): Promise<void>;

  // --- Scaling History (max 50) ---
  addScalingHistory(entry: ScalingHistoryEntry): Promise<void>;
  getScalingHistory(limit?: number): Promise<ScalingHistoryEntry[]>;

  // --- Simulation Config ---
  getSimulationConfig(): Promise<SimulationConfig>;
  setSimulationConfig(config: Partial<SimulationConfig>): Promise<void>;

  // --- Zero-Downtime Scaling ---
  getZeroDowntimeEnabled(): Promise<boolean>;
  setZeroDowntimeEnabled(enabled: boolean): Promise<void>;

  // --- Prediction Cache ---
  getLastPrediction(): Promise<PredictionResult | null>;
  setLastPrediction(prediction: PredictionResult): Promise<void>;
  getLastPredictionTime(): Promise<number>;
  setLastPredictionTime(time: number): Promise<void>;
  resetPredictionState(): Promise<void>;

  // --- Block Tracking (metrics/route.ts) ---
  getLastBlock(): Promise<{ height: string | null; time: string | null }>;
  setLastBlock(height: string, time: string): Promise<void>;

  // --- Connection Management ---
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

// ============================================================
// Configuration
// ============================================================

/**
 * Redis connection configuration
 */
export interface RedisConfig {
  /** Redis connection URL (e.g., redis://localhost:6379) */
  url: string;
  /** Key prefix for all SentinAI keys */
  keyPrefix: string;
  /** Connection timeout in milliseconds */
  connectTimeout: number;
  /** Maximum retry attempts */
  maxRetries: number;
}

export const DEFAULT_REDIS_CONFIG: Omit<RedisConfig, 'url'> = {
  keyPrefix: 'sentinai:',
  connectTimeout: 5000,
  maxRetries: 3,
};
