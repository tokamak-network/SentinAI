/**
 * Redis State Store Module
 * Dual implementation: RedisStateStore (production) / InMemoryStateStore (development)
 * Selected based on REDIS_URL environment variable
 */

import Redis from 'ioredis';
import {
  IStateStore,
  RedisConfig,
  DEFAULT_REDIS_CONFIG,
} from '@/types/redis';
import { MetricDataPoint, PredictionResult } from '@/types/prediction';
import {
  ScalingState,
  ScalingHistoryEntry,
  SimulationConfig,
  DEFAULT_SIMULATION_CONFIG,
} from '@/types/scaling';
import { AnomalyEvent, AlertRecord, DeepAnalysisResult, AlertConfig } from '@/types/anomaly';
import { UsageDataPoint } from '@/types/cost';
import { AccumulatorState, DailyAccumulatedData } from '@/types/daily-report';
import { PredictionRecord } from '@/types/prediction';

// ============================================================
// Constants
// ============================================================

const METRICS_BUFFER_MAX = 60;
const SCALING_HISTORY_MAX = 50;
const PREDICTION_TTL_SECONDS = 300; // 5 minutes

// P1 Constants
const ANOMALY_EVENTS_MAX = 100;
const ANOMALY_AUTO_RESOLVE_MS = 30 * 60 * 1000; // 30 minutes
const USAGE_DATA_MAX = 10080; // 7 days × 24 hours × 60 minutes

// P2 Constants
const DAILY_ACCUMULATOR_TTL = 48 * 60 * 60; // 48 hours
const ALERT_HISTORY_TTL = 24 * 60 * 60; // 24 hours
const ALERT_COOLDOWN_TTL = 10 * 60; // 10 minutes

// P3 Constants
const PREDICTION_MAX = 100;

// Redis key names (appended to keyPrefix)
const KEYS = {
  metricsBuffer: 'metrics:buffer',
  scalingState: 'scaling:state',
  scalingHistory: 'scaling:history',
  simulationConfig: 'scaling:simulation',
  zeroDowntimeEnabled: 'scaling:zerodowntime',
  predictionLatest: 'prediction:latest',
  predictionTime: 'prediction:time',
  lastBlock: 'metrics:lastblock',
  // P1: Anomaly Event Store
  anomalyEvents: 'anomaly:events',
  anomalyActive: 'anomaly:active',
  // P1: Usage Tracker
  usageData: 'usage:data',
  // P2: Daily Accumulator
  dailyAccumulator: (date: string) => `daily:accumulator:${date}`,
  // P2: Alert Dispatcher
  alertConfig: 'alerts:config',
  alertHistory: 'alerts:history',
  alertCooldown: (type: string) => `alerts:cooldown:${type}`,
  // P3: Prediction Tracker
  predictions: 'predictions:records',
} as const;

// ============================================================
// Default State Values
// ============================================================

const DEFAULT_SCALING_STATE: ScalingState = {
  currentVcpu: 1,
  currentMemoryGiB: 2,
  lastScalingTime: null,
  lastDecision: null,
  cooldownRemaining: 0,
  autoScalingEnabled: true,
};

// ============================================================
// RedisStateStore Implementation
// ============================================================

export class RedisStateStore implements IStateStore {
  private client: Redis;
  private prefix: string;
  private connected: boolean = false;

  constructor(config: RedisConfig) {
    this.prefix = config.keyPrefix;
    this.client = new Redis(config.url, {
      connectTimeout: config.connectTimeout,
      maxRetriesPerRequest: config.maxRetries,
      retryStrategy(times: number) {
        if (times > config.maxRetries) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    this.client.on('connect', () => {
      this.connected = true;
      console.log('[Redis Store] Connected');
    });

    this.client.on('error', (err) => {
      this.connected = false;
      console.error('[Redis Store] Error:', err.message);
    });

    this.client.on('close', () => {
      this.connected = false;
    });

    // Initiate connection
    this.client.connect().catch((err) => {
      console.error('[Redis Store] Initial connection failed:', err.message);
    });
  }

  private key(name: string): string {
    return `${this.prefix}${name}`;
  }

  // --- Metrics Buffer ---

  async pushMetric(dataPoint: MetricDataPoint): Promise<void> {
    const key = this.key(KEYS.metricsBuffer);
    await this.client.rpush(key, JSON.stringify(dataPoint));
    await this.client.ltrim(key, -METRICS_BUFFER_MAX, -1);
  }

  async getRecentMetrics(count?: number): Promise<MetricDataPoint[]> {
    const key = this.key(KEYS.metricsBuffer);
    let items: string[];
    if (count === undefined) {
      items = await this.client.lrange(key, 0, -1);
    } else {
      items = await this.client.lrange(key, -count, -1);
    }
    return items.map((item) => JSON.parse(item) as MetricDataPoint);
  }

  async clearMetrics(): Promise<void> {
    await this.client.del(this.key(KEYS.metricsBuffer));
  }

  async getMetricsCount(): Promise<number> {
    return this.client.llen(this.key(KEYS.metricsBuffer));
  }

  // --- Scaling State ---

  async getScalingState(): Promise<ScalingState> {
    const data = await this.client.hgetall(this.key(KEYS.scalingState));
    if (!data || Object.keys(data).length === 0) {
      return { ...DEFAULT_SCALING_STATE };
    }
    return {
      currentVcpu: Number(data.currentVcpu) || DEFAULT_SCALING_STATE.currentVcpu,
      currentMemoryGiB: Number(data.currentMemoryGiB) || DEFAULT_SCALING_STATE.currentMemoryGiB,
      lastScalingTime: data.lastScalingTime || null,
      lastDecision: data.lastDecision ? JSON.parse(data.lastDecision) : null,
      cooldownRemaining: Number(data.cooldownRemaining) || 0,
      autoScalingEnabled: data.autoScalingEnabled !== 'false',
    };
  }

  async updateScalingState(updates: Partial<ScalingState>): Promise<void> {
    const key = this.key(KEYS.scalingState);
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === undefined) {
        fields[k] = '';
      } else if (typeof v === 'object') {
        fields[k] = JSON.stringify(v);
      } else {
        fields[k] = String(v);
      }
    }
    if (Object.keys(fields).length > 0) {
      await this.client.hset(key, fields);
    }
  }

  // --- Scaling History ---

  async addScalingHistory(entry: ScalingHistoryEntry): Promise<void> {
    const key = this.key(KEYS.scalingHistory);
    await this.client.lpush(key, JSON.stringify(entry));
    await this.client.ltrim(key, 0, SCALING_HISTORY_MAX - 1);
  }

  async getScalingHistory(limit: number = 10): Promise<ScalingHistoryEntry[]> {
    const items = await this.client.lrange(this.key(KEYS.scalingHistory), 0, limit - 1);
    return items.map((item) => JSON.parse(item) as ScalingHistoryEntry);
  }

  // --- Simulation Config ---

  async getSimulationConfig(): Promise<SimulationConfig> {
    const data = await this.client.hgetall(this.key(KEYS.simulationConfig));
    if (!data || Object.keys(data).length === 0) {
      return {
        ...DEFAULT_SIMULATION_CONFIG,
        enabled: process.env.SCALING_SIMULATION_MODE !== 'false',
      };
    }
    return {
      enabled: data.enabled !== 'false',
      mockCurrentVcpu: Number(data.mockCurrentVcpu) || DEFAULT_SIMULATION_CONFIG.mockCurrentVcpu,
    };
  }

  async setSimulationConfig(config: Partial<SimulationConfig>): Promise<void> {
    const key = this.key(KEYS.simulationConfig);
    const fields: Record<string, string> = {};
    if (config.enabled !== undefined) fields.enabled = String(config.enabled);
    if (config.mockCurrentVcpu !== undefined) fields.mockCurrentVcpu = String(config.mockCurrentVcpu);
    if (Object.keys(fields).length > 0) {
      await this.client.hset(key, fields);
    }
  }

  // --- Zero-Downtime Scaling ---

  async getZeroDowntimeEnabled(): Promise<boolean> {
    const val = await this.client.get(this.key(KEYS.zeroDowntimeEnabled));
    return val === 'true';
  }

  async setZeroDowntimeEnabled(enabled: boolean): Promise<void> {
    await this.client.set(this.key(KEYS.zeroDowntimeEnabled), String(enabled));
  }

  // --- Prediction Cache ---

  async getLastPrediction(): Promise<PredictionResult | null> {
    const data = await this.client.get(this.key(KEYS.predictionLatest));
    return data ? (JSON.parse(data) as PredictionResult) : null;
  }

  async setLastPrediction(prediction: PredictionResult): Promise<void> {
    await this.client.set(
      this.key(KEYS.predictionLatest),
      JSON.stringify(prediction),
      'EX',
      PREDICTION_TTL_SECONDS
    );
  }

  async getLastPredictionTime(): Promise<number> {
    const data = await this.client.get(this.key(KEYS.predictionTime));
    return data ? Number(data) : 0;
  }

  async setLastPredictionTime(time: number): Promise<void> {
    await this.client.set(this.key(KEYS.predictionTime), String(time));
  }

  async resetPredictionState(): Promise<void> {
    await this.client.del(this.key(KEYS.predictionLatest));
    await this.client.del(this.key(KEYS.predictionTime));
  }

  // --- Block Tracking ---

  async getLastBlock(): Promise<{ height: string | null; time: string | null }> {
    const data = await this.client.hgetall(this.key(KEYS.lastBlock));
    return {
      height: data.height || null,
      time: data.time || null,
    };
  }

  async setLastBlock(height: string, time: string): Promise<void> {
    await this.client.hset(this.key(KEYS.lastBlock), { height, time });
  }

  // === P1: Anomaly Event Store ===

  async getAnomalyEvents(
    limit: number = 20,
    offset: number = 0
  ): Promise<{
    events: AnomalyEvent[];
    total: number;
    activeCount: number;
  }> {
    const key = this.key(KEYS.anomalyEvents);
    const total = await this.client.llen(key);

    // Get paginated events (newest first)
    const eventStrings = await this.client.lrange(
      key,
      offset,
      offset + limit - 1
    );
    const events = eventStrings
      .map((str) => {
        try {
          return JSON.parse(str) as AnomalyEvent;
        } catch {
          return null;
        }
      })
      .filter((e) => e !== null) as AnomalyEvent[];

    const activeCount = events.filter((e) => e.status === 'active').length;

    return { events, total, activeCount };
  }

  async getAnomalyEventById(eventId: string): Promise<AnomalyEvent | null> {
    const key = this.key(KEYS.anomalyEvents);
    const allStrings = await this.client.lrange(key, 0, -1);

    for (const str of allStrings) {
      try {
        const event = JSON.parse(str) as AnomalyEvent;
        if (event.id === eventId) {
          return event;
        }
      } catch {
        // Skip invalid JSON
      }
    }

    return null;
  }

  async createAnomalyEvent(event: AnomalyEvent): Promise<void> {
    const key = this.key(KEYS.anomalyEvents);

    // Add to list (newest first)
    await this.client.lpush(key, JSON.stringify(event));

    // Trim to max size
    await this.client.ltrim(key, 0, ANOMALY_EVENTS_MAX - 1);

    // Set TTL (7 days)
    await this.client.expire(key, 7 * 24 * 60 * 60);

    // Update active event if needed
    if (event.status === 'active') {
      await this.client.set(
        this.key(KEYS.anomalyActive),
        event.id,
        'EX',
        7 * 24 * 60 * 60
      );
    }
  }

  async updateAnomalyEvent(
    eventId: string,
    updates: Partial<AnomalyEvent>
  ): Promise<void> {
    const key = this.key(KEYS.anomalyEvents);
    const allStrings = await this.client.lrange(key, 0, -1);
    let found = false;

    for (let i = 0; i < allStrings.length; i++) {
      try {
        const event = JSON.parse(allStrings[i]) as AnomalyEvent;
        if (event.id === eventId) {
          const updated = { ...event, ...updates };

          // Replace in Redis (remove old, add new)
          await this.client.lrem(key, 1, allStrings[i]);
          await this.client.lpush(key, JSON.stringify(updated));

          // Update active event if status changed
          if (updates.status === 'resolved') {
            await this.client.del(this.key(KEYS.anomalyActive));
          } else if (updates.status === 'active') {
            await this.client.set(
              this.key(KEYS.anomalyActive),
              eventId,
              'EX',
              7 * 24 * 60 * 60
            );
          }

          found = true;
          break;
        }
      } catch {
        // Skip invalid JSON
      }
    }

    if (found) {
      // Trim to max size
      await this.client.ltrim(key, 0, ANOMALY_EVENTS_MAX - 1);
    }
  }

  async addDeepAnalysis(
    eventId: string,
    analysis: DeepAnalysisResult
  ): Promise<void> {
    const event = await this.getAnomalyEventById(eventId);
    if (event) {
      await this.updateAnomalyEvent(eventId, { deepAnalysis: analysis });
    }
  }

  async addAlertRecord(
    eventId: string,
    alert: AlertRecord
  ): Promise<void> {
    const event = await this.getAnomalyEventById(eventId);
    if (event) {
      const alerts = [...(event.alerts || []), alert];
      await this.updateAnomalyEvent(eventId, { alerts });
    }
  }

  async getActiveAnomalyEventId(): Promise<string | null> {
    const value = await this.client.get(this.key(KEYS.anomalyActive));
    return value || null;
  }

  async setActiveAnomalyEventId(eventId: string | null): Promise<void> {
    const key = this.key(KEYS.anomalyActive);
    if (eventId) {
      await this.client.set(
        key,
        eventId,
        'EX',
        7 * 24 * 60 * 60
      );
    } else {
      await this.client.del(key);
    }
  }

  async cleanupStaleAnomalyEvents(): Promise<void> {
    const { events } = await this.getAnomalyEvents(999, 0);
    const now = Date.now();

    for (const event of events) {
      if (
        event.status === 'active' &&
        now - event.timestamp > ANOMALY_AUTO_RESOLVE_MS
      ) {
        await this.updateAnomalyEvent(event.id, {
          status: 'resolved',
          resolvedAt: now,
        });
      }
    }
  }

  async clearAnomalyEvents(): Promise<void> {
    await this.client.del(this.key(KEYS.anomalyEvents));
    await this.client.del(this.key(KEYS.anomalyActive));
  }

  // === P1: Usage Tracker ===

  async pushUsageData(point: UsageDataPoint): Promise<void> {
    const key = this.key(KEYS.usageData);

    // Add to list (oldest first)
    await this.client.rpush(key, JSON.stringify(point));

    // Trim to max size (keep newest)
    await this.client.ltrim(key, -USAGE_DATA_MAX, -1);

    // Set TTL (7 days)
    await this.client.expire(key, 7 * 24 * 60 * 60);
  }

  async getUsageData(days: number): Promise<UsageDataPoint[]> {
    const key = this.key(KEYS.usageData);
    const allStrings = await this.client.lrange(key, 0, -1);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    return allStrings
      .map((str) => {
        try {
          return JSON.parse(str) as UsageDataPoint;
        } catch {
          return null;
        }
      })
      .filter((point) => point !== null && point.timestamp >= cutoff) as UsageDataPoint[];
  }

  async getUsageDataCount(): Promise<number> {
    const key = this.key(KEYS.usageData);
    return await this.client.llen(key);
  }

  async clearUsageData(): Promise<void> {
    await this.client.del(this.key(KEYS.usageData));
  }

  // === P2: Daily Accumulator ===

  async getDailyAccumulatorState(date: string): Promise<AccumulatorState | null> {
    const key = this.key(KEYS.dailyAccumulator(date));
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async setDailyAccumulatorState(date: string, state: AccumulatorState): Promise<void> {
    const key = this.key(KEYS.dailyAccumulator(date));
    await this.client.set(key, JSON.stringify(state), 'EX', DAILY_ACCUMULATOR_TTL);
  }

  async updateDailyAccumulatorData(
    date: string,
    updates: Partial<DailyAccumulatedData>
  ): Promise<void> {
    const state = await this.getDailyAccumulatorState(date);
    if (state) {
      state.data = { ...state.data, ...updates };
      await this.setDailyAccumulatorState(date, state);
    }
  }

  async deleteDailyAccumulatorState(date: string): Promise<void> {
    const key = this.key(KEYS.dailyAccumulator(date));
    await this.client.del(key);
  }

  // === P2: Alert Dispatcher ===

  async getAlertConfig(): Promise<AlertConfig> {
    const key = this.key(KEYS.alertConfig);
    const data = await this.client.get(key);
    return data
      ? JSON.parse(data)
      : {
          webhookUrl: process.env.ALERT_WEBHOOK_URL,
          thresholds: { notifyOn: ['high', 'critical'], cooldownMinutes: 10 },
          enabled: true,
        };
  }

  async setAlertConfig(config: AlertConfig): Promise<void> {
    const key = this.key(KEYS.alertConfig);
    await this.client.set(key, JSON.stringify(config));
  }

  async getAlertHistory(): Promise<AlertRecord[]> {
    await this.cleanupOldAlerts();
    const key = this.key(KEYS.alertHistory);
    const data = await this.client.lrange(key, 0, -1);
    return data.map((item) => JSON.parse(item));
  }

  async addAlertToHistory(record: AlertRecord): Promise<void> {
    const key = this.key(KEYS.alertHistory);
    await this.client.lpush(key, JSON.stringify(record));
    await this.client.ltrim(key, 0, 99); // Max 100
    await this.client.expire(key, ALERT_HISTORY_TTL);
  }

  async getLastAlertTime(anomalyType: string): Promise<number | null> {
    const key = this.key(KEYS.alertCooldown(anomalyType));
    const data = await this.client.get(key);
    return data ? parseInt(data, 10) : null;
  }

  async setLastAlertTime(anomalyType: string, timestamp: number): Promise<void> {
    const key = this.key(KEYS.alertCooldown(anomalyType));
    await this.client.set(key, timestamp.toString(), 'EX', ALERT_COOLDOWN_TTL);
  }

  async cleanupOldAlerts(): Promise<void> {
    const key = this.key(KEYS.alertHistory);
    const data = await this.client.lrange(key, 0, -1);
    const cutoff = Date.now() - ALERT_HISTORY_TTL * 1000;

    const filtered = data
      .map((item) => JSON.parse(item))
      .filter((a) => new Date(a.sentAt).getTime() > cutoff);

    await this.client.del(key);
    if (filtered.length > 0) {
      await this.client.rpush(key, ...filtered.map((item) => JSON.stringify(item)));
      await this.client.expire(key, ALERT_HISTORY_TTL);
    }
  }

  async clearAlertHistory(): Promise<void> {
    const key = this.key(KEYS.alertHistory);
    await this.client.del(key);

    // Clear all cooldown keys (pattern scan)
    const pattern = this.key('alerts:cooldown:*');
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  // === P3: Prediction Tracker ===

  async getPredictionRecords(limit: number = 20): Promise<PredictionRecord[]> {
    const key = this.key(KEYS.predictions);
    const data = await this.client.lrange(key, 0, limit - 1);
    return data.map((item) => JSON.parse(item));
  }

  async addPredictionRecord(record: PredictionRecord): Promise<void> {
    const key = this.key(KEYS.predictions);
    await this.client.lpush(key, JSON.stringify(record));
    await this.client.ltrim(key, 0, PREDICTION_MAX - 1);
  }

  async updatePredictionRecord(id: string, updates: Partial<PredictionRecord>): Promise<void> {
    const key = this.key(KEYS.predictions);
    const data = await this.client.lrange(key, 0, -1);

    const records = data.map((item) => JSON.parse(item));
    const index = records.findIndex((r) => r.id === id);

    if (index >= 0) {
      records[index] = { ...records[index], ...updates };
      await this.client.del(key);
      if (records.length > 0) {
        await this.client.rpush(key, ...records.map((r) => JSON.stringify(r)));
      }
    }
  }

  async clearPredictionRecords(): Promise<void> {
    const key = this.key(KEYS.predictions);
    await this.client.del(key);
  }

  // --- Connection Management ---

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
    this.connected = false;
  }
}

// ============================================================
// InMemoryStateStore Implementation
// ============================================================

export class InMemoryStateStore implements IStateStore {
  private metricsBuffer: MetricDataPoint[] = [];
  private scalingState: ScalingState = { ...DEFAULT_SCALING_STATE };
  private scalingHistory: ScalingHistoryEntry[] = [];
  private simulationConfig: SimulationConfig = {
    ...DEFAULT_SIMULATION_CONFIG,
    enabled: process.env.SCALING_SIMULATION_MODE !== 'false',
  };
  private zeroDowntimeEnabled: boolean = false;
  private lastPrediction: PredictionResult | null = null;
  private lastPredictionTime: number = 0;
  private lastBlock: { height: string | null; time: string | null } = {
    height: null,
    time: null,
  };

  // P1: Anomaly Event Store
  private anomalyEvents: AnomalyEvent[] = [];
  private activeAnomalyEventId: string | null = null;

  // P1: Usage Tracker
  private usageData: UsageDataPoint[] = [];

  // P2: Daily Accumulator
  private dailyAccumulatorStates: Map<string, AccumulatorState> = new Map();

  // P2: Alert Dispatcher
  private alertConfig: AlertConfig = {
    webhookUrl: process.env.ALERT_WEBHOOK_URL,
    thresholds: { notifyOn: ['high', 'critical'], cooldownMinutes: 10 },
    enabled: true,
  };
  private alertHistory: AlertRecord[] = [];
  private lastAlertByType: Map<string, number> = new Map();

  // P3: Prediction Tracker
  private predictionRecords: PredictionRecord[] = [];

  // --- Metrics Buffer ---

  async pushMetric(dataPoint: MetricDataPoint): Promise<void> {
    this.metricsBuffer.push(dataPoint);
    if (this.metricsBuffer.length > METRICS_BUFFER_MAX) {
      this.metricsBuffer = this.metricsBuffer.slice(-METRICS_BUFFER_MAX);
    }
  }

  async getRecentMetrics(count?: number): Promise<MetricDataPoint[]> {
    if (count === undefined || count >= this.metricsBuffer.length) {
      return [...this.metricsBuffer];
    }
    return this.metricsBuffer.slice(-count);
  }

  async clearMetrics(): Promise<void> {
    this.metricsBuffer = [];
  }

  async getMetricsCount(): Promise<number> {
    return this.metricsBuffer.length;
  }

  // --- Scaling State ---

  async getScalingState(): Promise<ScalingState> {
    return { ...this.scalingState };
  }

  async updateScalingState(updates: Partial<ScalingState>): Promise<void> {
    this.scalingState = { ...this.scalingState, ...updates };
  }

  // --- Scaling History ---

  async addScalingHistory(entry: ScalingHistoryEntry): Promise<void> {
    this.scalingHistory.unshift(entry);
    if (this.scalingHistory.length > SCALING_HISTORY_MAX) {
      this.scalingHistory = this.scalingHistory.slice(0, SCALING_HISTORY_MAX);
    }
  }

  async getScalingHistory(limit: number = 10): Promise<ScalingHistoryEntry[]> {
    return this.scalingHistory.slice(0, limit);
  }

  // --- Simulation Config ---

  async getSimulationConfig(): Promise<SimulationConfig> {
    return { ...this.simulationConfig };
  }

  async setSimulationConfig(config: Partial<SimulationConfig>): Promise<void> {
    this.simulationConfig = { ...this.simulationConfig, ...config };
  }

  // --- Zero-Downtime Scaling ---

  async getZeroDowntimeEnabled(): Promise<boolean> {
    return this.zeroDowntimeEnabled;
  }

  async setZeroDowntimeEnabled(enabled: boolean): Promise<void> {
    this.zeroDowntimeEnabled = enabled;
  }

  // --- Prediction Cache ---

  async getLastPrediction(): Promise<PredictionResult | null> {
    return this.lastPrediction;
  }

  async setLastPrediction(prediction: PredictionResult): Promise<void> {
    this.lastPrediction = prediction;
  }

  async getLastPredictionTime(): Promise<number> {
    return this.lastPredictionTime;
  }

  async setLastPredictionTime(time: number): Promise<void> {
    this.lastPredictionTime = time;
  }

  async resetPredictionState(): Promise<void> {
    this.lastPrediction = null;
    this.lastPredictionTime = 0;
  }

  // --- Block Tracking ---

  async getLastBlock(): Promise<{ height: string | null; time: string | null }> {
    return { ...this.lastBlock };
  }

  async setLastBlock(height: string, time: string): Promise<void> {
    this.lastBlock = { height, time };
  }

  // === P1: Anomaly Event Store ===

  async getAnomalyEvents(
    limit: number = 20,
    offset: number = 0
  ): Promise<{
    events: AnomalyEvent[];
    total: number;
    activeCount: number;
  }> {
    await this.cleanupStaleAnomalyEvents();

    const activeCount = this.anomalyEvents.filter(
      (e) => e.status === 'active'
    ).length;
    const paginatedEvents = this.anomalyEvents.slice(
      offset,
      offset + limit
    );

    return {
      events: paginatedEvents,
      total: this.anomalyEvents.length,
      activeCount,
    };
  }

  async getAnomalyEventById(eventId: string): Promise<AnomalyEvent | null> {
    return (
      this.anomalyEvents.find((e) => e.id === eventId) || null
    );
  }

  async createAnomalyEvent(event: AnomalyEvent): Promise<void> {
    this.anomalyEvents.unshift(event);
    if (this.anomalyEvents.length > ANOMALY_EVENTS_MAX) {
      this.anomalyEvents = this.anomalyEvents.slice(
        0,
        ANOMALY_EVENTS_MAX
      );
    }
    if (event.status === 'active') {
      this.activeAnomalyEventId = event.id;
    }
  }

  async updateAnomalyEvent(
    eventId: string,
    updates: Partial<AnomalyEvent>
  ): Promise<void> {
    const event = this.anomalyEvents.find((e) => e.id === eventId);
    if (event) {
      Object.assign(event, updates);
      if (updates.status === 'resolved' && this.activeAnomalyEventId === eventId) {
        this.activeAnomalyEventId = null;
      }
    }
  }

  async addDeepAnalysis(
    eventId: string,
    analysis: DeepAnalysisResult
  ): Promise<void> {
    const event = this.anomalyEvents.find((e) => e.id === eventId);
    if (event) {
      event.deepAnalysis = analysis;
    }
  }

  async addAlertRecord(
    eventId: string,
    alert: AlertRecord
  ): Promise<void> {
    const event = this.anomalyEvents.find((e) => e.id === eventId);
    if (event) {
      event.alerts.push(alert);
    }
  }

  async getActiveAnomalyEventId(): Promise<string | null> {
    await this.cleanupStaleAnomalyEvents();
    return this.activeAnomalyEventId;
  }

  async setActiveAnomalyEventId(
    eventId: string | null
  ): Promise<void> {
    this.activeAnomalyEventId = eventId;
  }

  async cleanupStaleAnomalyEvents(): Promise<void> {
    const now = Date.now();

    // Auto-resolve stale events
    for (const event of this.anomalyEvents) {
      if (
        event.status === 'active' &&
        now - event.timestamp > ANOMALY_AUTO_RESOLVE_MS
      ) {
        event.status = 'resolved';
        event.resolvedAt = now;
      }
    }

    // Update active event ID
    const activeEvent = this.anomalyEvents.find(
      (e) => e.status === 'active'
    );
    this.activeAnomalyEventId = activeEvent?.id || null;
  }

  async clearAnomalyEvents(): Promise<void> {
    this.anomalyEvents = [];
    this.activeAnomalyEventId = null;
  }

  // === P1: Usage Tracker ===

  async pushUsageData(point: UsageDataPoint): Promise<void> {
    this.usageData.push(point);
    if (this.usageData.length > USAGE_DATA_MAX) {
      this.usageData = this.usageData.slice(-USAGE_DATA_MAX);
    }
  }

  async getUsageData(days: number): Promise<UsageDataPoint[]> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.usageData.filter((point) => point.timestamp >= cutoff);
  }

  async getUsageDataCount(): Promise<number> {
    return this.usageData.length;
  }

  async clearUsageData(): Promise<void> {
    this.usageData = [];
  }

  // === P2: Daily Accumulator ===

  async getDailyAccumulatorState(date: string): Promise<AccumulatorState | null> {
    return this.dailyAccumulatorStates.get(date) || null;
  }

  async setDailyAccumulatorState(date: string, state: AccumulatorState): Promise<void> {
    this.dailyAccumulatorStates.set(date, state);

    // Keep only last 7 days
    if (this.dailyAccumulatorStates.size > 7) {
      const dates = Array.from(this.dailyAccumulatorStates.keys()).sort();
      this.dailyAccumulatorStates.delete(dates[0]);
    }
  }

  async updateDailyAccumulatorData(
    date: string,
    updates: Partial<DailyAccumulatedData>
  ): Promise<void> {
    const state = this.dailyAccumulatorStates.get(date);
    if (state) {
      state.data = { ...state.data, ...updates };
      this.dailyAccumulatorStates.set(date, state);
    }
  }

  async deleteDailyAccumulatorState(date: string): Promise<void> {
    this.dailyAccumulatorStates.delete(date);
  }

  // === P2: Alert Dispatcher ===

  async getAlertConfig(): Promise<AlertConfig> {
    return { ...this.alertConfig };
  }

  async setAlertConfig(config: AlertConfig): Promise<void> {
    this.alertConfig = { ...config };
  }

  async getAlertHistory(): Promise<AlertRecord[]> {
    await this.cleanupOldAlerts();
    return [...this.alertHistory];
  }

  async addAlertToHistory(record: AlertRecord): Promise<void> {
    this.alertHistory.push(record);
    if (this.alertHistory.length > 100) {
      this.alertHistory = this.alertHistory.slice(-100);
    }
  }

  async getLastAlertTime(anomalyType: string): Promise<number | null> {
    return this.lastAlertByType.get(anomalyType) || null;
  }

  async setLastAlertTime(anomalyType: string, timestamp: number): Promise<void> {
    this.lastAlertByType.set(anomalyType, timestamp);
  }

  async cleanupOldAlerts(): Promise<void> {
    const cutoff = Date.now() - ALERT_HISTORY_TTL * 1000;
    this.alertHistory = this.alertHistory.filter((a) => new Date(a.sentAt).getTime() > cutoff);
  }

  async clearAlertHistory(): Promise<void> {
    this.alertHistory = [];
    this.lastAlertByType.clear();
  }

  // === P3: Prediction Tracker ===

  async getPredictionRecords(limit: number = 20): Promise<PredictionRecord[]> {
    return [...this.predictionRecords].reverse().slice(0, limit);
  }

  async addPredictionRecord(record: PredictionRecord): Promise<void> {
    this.predictionRecords.push(record);
    if (this.predictionRecords.length > PREDICTION_MAX) {
      this.predictionRecords = this.predictionRecords.slice(-PREDICTION_MAX);
    }
  }

  async updatePredictionRecord(id: string, updates: Partial<PredictionRecord>): Promise<void> {
    const record = this.predictionRecords.find((r) => r.id === id);
    if (record) {
      Object.assign(record, updates);
    }
  }

  async clearPredictionRecords(): Promise<void> {
    this.predictionRecords = [];
  }

  // --- Connection Management ---

  isConnected(): boolean {
    return true; // Always "connected" for in-memory
  }

  async disconnect(): Promise<void> {
    // No-op for in-memory
  }
}

// ============================================================
// Factory: Store Singleton
// Use globalThis to survive Next.js dev mode module re-evaluation (Turbopack)
// ============================================================

const globalForStore = globalThis as unknown as { __sentinai_store?: IStateStore };

/**
 * Get the state store singleton
 * Uses Redis if REDIS_URL is set, otherwise falls back to InMemory
 */
export function getStore(): IStateStore {
  if (globalForStore.__sentinai_store) return globalForStore.__sentinai_store;

  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    console.log('[State Store] Using Redis:', redisUrl.replace(/\/\/.*@/, '//<credentials>@'));
    globalForStore.__sentinai_store = new RedisStateStore({
      url: redisUrl,
      ...DEFAULT_REDIS_CONFIG,
    });
  } else {
    console.log('[State Store] Using InMemory (set REDIS_URL for persistence)');
    globalForStore.__sentinai_store = new InMemoryStateStore();
  }

  return globalForStore.__sentinai_store;
}

/**
 * Reset store singleton (for testing)
 */
export async function resetStore(): Promise<void> {
  if (globalForStore.__sentinai_store) {
    await globalForStore.__sentinai_store.disconnect();
    globalForStore.__sentinai_store = undefined;
  }
}
