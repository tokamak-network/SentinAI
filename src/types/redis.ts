/**
 * Redis State Store Types
 * Strategy Pattern interface for Redis / InMemory dual implementation
 */

import { MetricDataPoint, PredictionRecord } from './prediction';
import { ScalingState, ScalingHistoryEntry, SimulationConfig } from './scaling';
import { PredictionResult } from './prediction';
import { AnomalyEvent, AlertRecord, DeepAnalysisResult, AlertConfig } from './anomaly';
import { UsageDataPoint } from './cost';
import { AccumulatorState, DailyAccumulatedData } from './daily-report';

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

  // --- Seed Scenario (Cross-Worker Persistence) ---
  getSeedScenario(): Promise<string | null>;
  setSeedScenario(scenario: string | null): Promise<void>;

  // --- Agent Cycle History (Cross-Worker Persistence) ---
  pushAgentCycleResult(result: any): Promise<void>;
  getAgentCycleHistory(limit?: number): Promise<any[]>;
  getLastAgentCycleResult(): Promise<any | null>;
  clearAgentCycleHistory(): Promise<void>;

  // --- Connection Management ---
  isConnected(): boolean;
  disconnect(): Promise<void>;

  // === P1 (HIGH PRIORITY): Anomaly Event Store ===
  // Event storage and retrieval
  getAnomalyEvents(limit?: number, offset?: number): Promise<{
    events: AnomalyEvent[];
    total: number;
    activeCount: number;
  }>;
  getAnomalyEventById(eventId: string): Promise<AnomalyEvent | null>;
  createAnomalyEvent(event: AnomalyEvent): Promise<void>;
  updateAnomalyEvent(eventId: string, updates: Partial<AnomalyEvent>): Promise<void>;
  addDeepAnalysis(eventId: string, analysis: DeepAnalysisResult): Promise<void>;
  addAlertRecord(eventId: string, alert: AlertRecord): Promise<void>;

  // Active event management
  getActiveAnomalyEventId(): Promise<string | null>;
  setActiveAnomalyEventId(eventId: string | null): Promise<void>;

  // Cleanup
  cleanupStaleAnomalyEvents(): Promise<void>;
  clearAnomalyEvents(): Promise<void>;

  // === P1 (HIGH PRIORITY): Usage Tracker ===
  // Usage data storage
  pushUsageData(point: UsageDataPoint): Promise<void>;
  getUsageData(days: number): Promise<UsageDataPoint[]>;
  getUsageDataCount(): Promise<number>;
  clearUsageData(): Promise<void>;

  // === P2 (MEDIUM PRIORITY): Daily Accumulator ===
  // Daily metric snapshots and summaries storage
  getDailyAccumulatorState(date: string): Promise<AccumulatorState | null>;
  setDailyAccumulatorState(date: string, state: AccumulatorState): Promise<void>;
  updateDailyAccumulatorData(date: string, updates: Partial<DailyAccumulatedData>): Promise<void>;
  deleteDailyAccumulatorState(date: string): Promise<void>;

  // === P2 (MEDIUM PRIORITY): Alert Dispatcher ===
  // Alert configuration, history, and cooldown management
  getAlertConfig(): Promise<AlertConfig>;
  setAlertConfig(config: AlertConfig): Promise<void>;
  getAlertHistory(): Promise<AlertRecord[]>;
  addAlertToHistory(record: AlertRecord): Promise<void>;
  getLastAlertTime(anomalyType: string): Promise<number | null>;
  setLastAlertTime(anomalyType: string, timestamp: number): Promise<void>;
  cleanupOldAlerts(): Promise<void>;
  clearAlertHistory(): Promise<void>;

  // === P3 (LOW PRIORITY): Prediction Tracker ===
  // AI prediction accuracy tracking
  getPredictionRecords(limit?: number): Promise<PredictionRecord[]>;
  addPredictionRecord(record: PredictionRecord): Promise<void>;
  updatePredictionRecord(id: string, updates: Partial<PredictionRecord>): Promise<void>;
  clearPredictionRecords(): Promise<void>;
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
