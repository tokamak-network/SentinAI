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

// ============================================================
// Constants
// ============================================================

const METRICS_BUFFER_MAX = 60;
const SCALING_HISTORY_MAX = 50;
const PREDICTION_TTL_SECONDS = 300; // 5 minutes

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
// ============================================================

let storeInstance: IStateStore | null = null;

/**
 * Get the state store singleton
 * Uses Redis if REDIS_URL is set, otherwise falls back to InMemory
 */
export function getStore(): IStateStore {
  if (storeInstance) return storeInstance;

  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    console.log('[State Store] Using Redis:', redisUrl.replace(/\/\/.*@/, '//<credentials>@'));
    storeInstance = new RedisStateStore({
      url: redisUrl,
      ...DEFAULT_REDIS_CONFIG,
    });
  } else {
    console.log('[State Store] Using InMemory (set REDIS_URL for persistence)');
    storeInstance = new InMemoryStateStore();
  }

  return storeInstance;
}

/**
 * Reset store singleton (for testing)
 */
export async function resetStore(): Promise<void> {
  if (storeInstance) {
    await storeInstance.disconnect();
    storeInstance = null;
  }
}
