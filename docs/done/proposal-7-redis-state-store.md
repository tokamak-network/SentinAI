# Proposal 7: Redis State Store (state persistence layer)

## Document information

| Item | Content |
|------|------|
| version | 1.0.0 |
| Created date | 2026-02-06 |
| target | Claude Opus 4.6 Implementation Agent |
| Dependency | Proposal 1 (MetricsStore, PredictiveScaler) — Modify existing implementation |

---

## 1. Overview

### 1.1 Feature Summary

It is a persistence layer that migrates all of SentinAI's in-memory state to Redis to achieve **maintaining the state upon server restart** and **sharing the state between multiple instances**.

### 1.2 Solving Problems

Currently, all runtime state of SentinAI is stored in Node.js process memory:

1. **State loss**: When restarting the server, redistributing, or regenerating containers, metrics (up to 1 hour), scaling history (50 cases), and prediction cache are all lost.
2. **Instance mismatch**: When multiple instances are deployed behind a load balancer, each instance has an independent state. Even if scaling occurs in instance A, instance B is not aware of it.
3. **Awareness in code**: There is a comment `// Recommended to use Redis or DB in actual production` in line 24 of `src/lib/k8s-scaler.ts`, and the user is aware of the limitations of the current in-memory method.

### 1.3 Core Values

- **Stateless Server**: The application server has no state, allowing for free scale-out/restart.
- **State Persistence**: Preserve metrics, scaling state, and prediction cache regardless of process life cycle.
- **Gradual introduction**: Strategy Pattern that maintains 100% of the existing in-memory operation when `REDIS_URL` is not set.

### 1.4 Dependencies

- **Proposal 1** (Predictive Scaling): Modify `metrics-store.ts`, `predictive-scaler.ts` — Convert code that has already been implemented to async
- **npm package**: `ioredis` (new dependency)

---

## 2. Type Definitions

### 2.1 New file: `src/types/redis.ts`

```typescript
/**
 * Redis State Store Types
 * Strategy Pattern interface for Redis / InMemory dual implementation
 */

import { MetricDataPoint, MetricsStoreStats } from './prediction';
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
```

---

## 3. New file specifications (New Files)

### 3.1 `src/lib/redis-store.ts` (core module)

#### Full implementation code

```typescript
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
import { MetricDataPoint, MetricsStoreStats, PredictionResult } from '@/types/prediction';
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
```

#### Function signature summary

| function | input | output | Description |
|------|------|------|------|
| `getStore()` | - | `IStateStore` | return singleton store instance |
| `resetStore()` | - | `Promise<void>` | Store Reset (for testing) |
| `store.pushMetric(dp)` | `MetricDataPoint` | `Promise<void>` | 메트릭 추가 (RPUSH + LTRIM 60) |
| `store.getRecentMetrics(n?)` | `number?` | `Promise<MetricDataPoint[]>` | View the most recent N metrics |
| `store.clearMetrics()` | - | `Promise<void>` | Metric buffer initialization |
| `store.getMetricsCount()` | - | `Promise<number>` | Current metric count |
| `store.getScalingState()` | - | `Promise<ScalingState>` | Check scaling status |
| `store.updateScalingState(u)` | `Partial<ScalingState>` | `Promise<void>` | Scaling status update |
| `store.addScalingHistory(e)` | `ScalingHistoryEntry` | `Promise<void>` | Add History (LPUSH + LTRIM 50) |
| `store.getScalingHistory(n?)` | `number?` | `Promise<ScalingHistoryEntry[]>` | History search |
| `store.getSimulationConfig()` | - | `Promise<SimulationConfig>` | Simulation settings inquiry |
| `store.setSimulationConfig(c)` | `Partial<SimulationConfig>` | `Promise<void>` | Change simulation settings |
| `store.getLastPrediction()` | - | `Promise<PredictionResult\| null>` | Cached prediction lookup |
| `store.setLastPrediction(p)` | `PredictionResult` | `Promise<void>` | Save prediction cache (TTL 300s) |
| `store.getLastPredictionTime()` | - | `Promise<number>` | Last forecast time |
| `store.setLastPredictionTime(t)` | `number` | `Promise<void>` | Save prediction time |
| `store.resetPredictionState()` | - | `Promise<void>` | speculative cache/time initialization |
| `store.getLastBlock()` | - | `Promise<{height, time}>` | Last block information |
| `store.setLastBlock(h, t)` | `string, string` | `Promise<void>` | Save block information |

---

## 4. Existing File Modifications

### 4.1 Fix `src/lib/metrics-store.ts` — full replacement

Replace the existing in-memory array with `getStore()` and convert all functions to async.

#### Full replacement code

```typescript
/**
 * Metrics Store Module
 * Ring buffer implementation for time-series metric storage
 * Shared across Predictive Scaling, Anomaly Detection, and Analytics
 *
 * Storage: Redis (if REDIS_URL set) or InMemory (fallback)
 */

import { MetricDataPoint, MetricsStoreStats, MetricStatSummary } from '@/types/prediction';
import { getStore } from '@/lib/redis-store';

/** Threshold for trend detection: slope magnitude below this is "stable" */
const TREND_THRESHOLD = 0.5;

/**
 * Push a new data point to the metrics store
 * Automatically evicts oldest data if buffer is full (max 60)
 */
export async function pushMetric(dataPoint: MetricDataPoint): Promise<void> {
  await getStore().pushMetric(dataPoint);
}

/**
 * Get recent data points from the store
 *
 * @param count - Number of recent points to retrieve (default: all)
 * @returns Array of data points, newest last
 */
export async function getRecentMetrics(count?: number): Promise<MetricDataPoint[]> {
  return getStore().getRecentMetrics(count);
}

/**
 * Calculate statistical summary for a numeric array
 */
function calculateStats(values: number[]): MetricStatSummary {
  if (values.length === 0) {
    return {
      mean: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      trend: 'stable',
      slope: 0,
    };
  }

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  const stdDev = Math.sqrt(variance);

  const min = Math.min(...values);
  const max = Math.max(...values);

  const n = values.length;
  const xMean = (n - 1) / 2;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    const xDiff = i - xMean;
    const yDiff = values[i] - mean;
    numerator += xDiff * yDiff;
    denominator += xDiff * xDiff;
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;

  let trend: 'rising' | 'falling' | 'stable';
  if (slope > TREND_THRESHOLD) {
    trend = 'rising';
  } else if (slope < -TREND_THRESHOLD) {
    trend = 'falling';
  } else {
    trend = 'stable';
  }

  return {
    mean: Number(mean.toFixed(2)),
    stdDev: Number(stdDev.toFixed(2)),
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    trend,
    slope: Number(slope.toFixed(4)),
  };
}

/**
 * Get comprehensive statistics about stored metrics
 * Fetches all data points from store, then computes stats in-memory
 */
export async function getMetricsStats(): Promise<MetricsStoreStats> {
  const metricsBuffer = await getStore().getRecentMetrics();

  if (metricsBuffer.length === 0) {
    return {
      count: 0,
      oldestTimestamp: null,
      newestTimestamp: null,
      stats: {
        cpu: calculateStats([]),
        txPool: calculateStats([]),
        gasUsedRatio: calculateStats([]),
        blockInterval: calculateStats([]),
      },
    };
  }

  const cpuValues = metricsBuffer.map(m => m.cpuUsage);
  const txPoolValues = metricsBuffer.map(m => m.txPoolPending);
  const gasValues = metricsBuffer.map(m => m.gasUsedRatio);
  const blockIntervalValues = metricsBuffer.map(m => m.blockInterval);

  return {
    count: metricsBuffer.length,
    oldestTimestamp: metricsBuffer[0].timestamp,
    newestTimestamp: metricsBuffer[metricsBuffer.length - 1].timestamp,
    stats: {
      cpu: calculateStats(cpuValues),
      txPool: calculateStats(txPoolValues),
      gasUsedRatio: calculateStats(gasValues),
      blockInterval: calculateStats(blockIntervalValues),
    },
  };
}

/**
 * Clear all stored metrics
 */
export async function clearMetrics(): Promise<void> {
  await getStore().clearMetrics();
}

/**
 * Get current buffer size
 */
export async function getMetricsCount(): Promise<number> {
  return getStore().getMetricsCount();
}

/**
 * Export buffer capacity constant for external use
 */
export const METRICS_BUFFER_CAPACITY = 60;
```

---

### 4.2 Fix `src/lib/k8s-scaler.ts` — full replacement.

Replace the in-memory state variable with `getStore()` and switch the state access function to async.

#### Full replacement code

```typescript
/**
 * K8s Scaler Module
 * Patch StatefulSet resources via kubectl
 *
 * Storage: Redis (if REDIS_URL set) or InMemory (fallback)
 */

import {
  ScaleResult,
  ScalingState,
  ScalingHistoryEntry,
  ScalingConfig,
  DEFAULT_SCALING_CONFIG,
  SimulationConfig,
} from '@/types/scaling';
import { runK8sCommand } from '@/lib/k8s-config';
import { getStore } from '@/lib/redis-store';

/**
 * Check simulation mode status
 */
export async function isSimulationMode(): Promise<boolean> {
  const config = await getStore().getSimulationConfig();
  return config.enabled;
}

/**
 * Set simulation mode
 */
export async function setSimulationMode(enabled: boolean): Promise<void> {
  await getStore().setSimulationConfig({ enabled });
}

/**
 * Get simulation config
 */
export async function getSimulationConfig(): Promise<SimulationConfig> {
  return getStore().getSimulationConfig();
}

/**
 * Get current op-geth vCPU
 */
export async function getCurrentVcpu(
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): Promise<number> {
  const simConfig = await getStore().getSimulationConfig();

  // Simulation mode: Return stored state
  if (simConfig.enabled) {
    const state = await getStore().getScalingState();
    return state.currentVcpu;
  }

  try {
    const { namespace, statefulSetName, containerIndex } = config;
    const cmd = `get statefulset ${statefulSetName} -n ${namespace} -o jsonpath='{.spec.template.spec.containers[${containerIndex}].resources.requests.cpu}'`;
    const { stdout } = await runK8sCommand(cmd);

    const cpuStr = stdout.replace(/'/g, '').trim();
    if (cpuStr.includes('m')) {
      return parseFloat(cpuStr) / 1000;
    }
    return parseFloat(cpuStr) || 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to get current vCPU:', message);
    const state = await getStore().getScalingState();
    return state.currentVcpu || 1;
  }
}

/**
 * Check cooldown
 */
export async function checkCooldown(
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): Promise<{ inCooldown: boolean; remainingSeconds: number }> {
  const state = await getStore().getScalingState();

  if (!state.lastScalingTime) {
    return { inCooldown: false, remainingSeconds: 0 };
  }

  const lastScaling = new Date(state.lastScalingTime).getTime();
  const now = Date.now();
  const elapsed = (now - lastScaling) / 1000;
  const remaining = Math.max(0, config.cooldownSeconds - elapsed);

  return {
    inCooldown: remaining > 0,
    remainingSeconds: Math.ceil(remaining),
  };
}

/**
 * Execute op-geth vCPU/Memory scaling
 */
export async function scaleOpGeth(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig = DEFAULT_SCALING_CONFIG,
  dryRun: boolean = false
): Promise<ScaleResult> {
  const store = getStore();
  const { namespace, statefulSetName, containerIndex, minVcpu, maxVcpu } = config;
  const timestamp = new Date().toISOString();
  const state = await store.getScalingState();

  // Range validation
  if (targetVcpu < minVcpu || targetVcpu > maxVcpu) {
    return {
      success: false,
      previousVcpu: state.currentVcpu,
      currentVcpu: state.currentVcpu,
      previousMemoryGiB: state.currentMemoryGiB,
      currentMemoryGiB: state.currentMemoryGiB,
      timestamp,
      message: `vCPU must be between ${minVcpu} and ${maxVcpu}`,
      error: 'OUT_OF_RANGE',
    };
  }

  // Cooldown check
  const cooldown = await checkCooldown(config);
  if (cooldown.inCooldown && !dryRun) {
    return {
      success: false,
      previousVcpu: state.currentVcpu,
      currentVcpu: state.currentVcpu,
      previousMemoryGiB: state.currentMemoryGiB,
      currentMemoryGiB: state.currentMemoryGiB,
      timestamp,
      message: `Cooldown active. ${cooldown.remainingSeconds}s remaining`,
      error: 'COOLDOWN',
    };
  }

  // Get current state
  const currentVcpu = await getCurrentVcpu(config);

  // Skip if values are the same
  if (currentVcpu === targetVcpu && !dryRun) {
    return {
      success: true,
      previousVcpu: currentVcpu,
      currentVcpu: currentVcpu,
      previousMemoryGiB: state.currentMemoryGiB,
      currentMemoryGiB: targetMemoryGiB,
      timestamp,
      message: 'No scaling needed - already at target',
    };
  }

  // Dry run mode
  if (dryRun) {
    return {
      success: true,
      previousVcpu: currentVcpu,
      currentVcpu: targetVcpu,
      previousMemoryGiB: state.currentMemoryGiB,
      currentMemoryGiB: targetMemoryGiB,
      timestamp,
      message: `[DRY RUN] Would scale from ${currentVcpu} to ${targetVcpu} vCPU`,
    };
  }

  // Simulation mode: Update state only without actual kubectl execution
  const simConfig = await store.getSimulationConfig();
  if (simConfig.enabled) {
    const previousVcpu = state.currentVcpu;
    const previousMemoryGiB = state.currentMemoryGiB;

    await store.updateScalingState({
      currentVcpu: targetVcpu,
      currentMemoryGiB: targetMemoryGiB,
      lastScalingTime: timestamp,
    });

    return {
      success: true,
      previousVcpu,
      currentVcpu: targetVcpu,
      previousMemoryGiB,
      currentMemoryGiB: targetMemoryGiB,
      timestamp,
      message: `[SIMULATION] Scaled from ${previousVcpu} to ${targetVcpu} vCPU (No actual K8s changes)`,
    };
  }

  try {
    // Execute kubectl patch command
    const patchJson = JSON.stringify([
      {
        op: 'replace',
        path: `/spec/template/spec/containers/${containerIndex}/resources/requests/cpu`,
        value: `${targetVcpu}`,
      },
      {
        op: 'replace',
        path: `/spec/template/spec/containers/${containerIndex}/resources/requests/memory`,
        value: `${targetMemoryGiB}Gi`,
      },
      {
        op: 'replace',
        path: `/spec/template/spec/containers/${containerIndex}/resources/limits/cpu`,
        value: `${targetVcpu}`,
      },
      {
        op: 'replace',
        path: `/spec/template/spec/containers/${containerIndex}/resources/limits/memory`,
        value: `${targetMemoryGiB}Gi`,
      },
    ]);

    const cmd = `patch statefulset ${statefulSetName} -n ${namespace} --type='json' -p='${patchJson}'`;
    await runK8sCommand(cmd);

    // Update state
    const previousVcpu = state.currentVcpu;
    const previousMemoryGiB = state.currentMemoryGiB;

    await store.updateScalingState({
      currentVcpu: targetVcpu,
      currentMemoryGiB: targetMemoryGiB,
      lastScalingTime: timestamp,
    });

    return {
      success: true,
      previousVcpu,
      currentVcpu: targetVcpu,
      previousMemoryGiB,
      currentMemoryGiB: targetMemoryGiB,
      timestamp,
      message: `Scaled from ${previousVcpu} to ${targetVcpu} vCPU successfully`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Scaling failed:', errorMessage);
    return {
      success: false,
      previousVcpu: currentVcpu,
      currentVcpu: currentVcpu,
      previousMemoryGiB: state.currentMemoryGiB,
      currentMemoryGiB: state.currentMemoryGiB,
      timestamp,
      message: 'Failed to execute kubectl patch',
      error: errorMessage,
    };
  }
}

/**
 * Get current scaling state
 */
export async function getScalingState(
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): Promise<ScalingState> {
  const state = await getStore().getScalingState();
  const cooldown = await checkCooldown(config);
  return {
    ...state,
    cooldownRemaining: cooldown.remainingSeconds,
  };
}

/**
 * Update scaling state (Manual)
 */
export async function updateScalingState(updates: Partial<ScalingState>): Promise<void> {
  await getStore().updateScalingState(updates);
}

/**
 * Add scaling history
 */
export async function addScalingHistory(entry: ScalingHistoryEntry): Promise<void> {
  await getStore().addScalingHistory(entry);
}

/**
 * Get scaling history
 */
export async function getScalingHistory(limit: number = 10): Promise<ScalingHistoryEntry[]> {
  return getStore().getScalingHistory(limit);
}

/**
 * Enable/Disable auto-scaling
 */
export async function setAutoScalingEnabled(enabled: boolean): Promise<void> {
  await getStore().updateScalingState({ autoScalingEnabled: enabled });
}

/**
 * Check auto-scaling status
 */
export async function isAutoScalingEnabled(): Promise<boolean> {
  const state = await getStore().getScalingState();
  return state.autoScalingEnabled;
}
```

---

### 4.3 Modify `src/lib/predictive-scaler.ts`

#### 4.3.1 Import modification and status variable removal

**Replace top of file (lines 1-21)**

```typescript
/**
 * Predictive Scaler Module
 * AI-powered time-series analysis for preemptive scaling decisions
 *
 * Storage: Redis (if REDIS_URL set) or InMemory (fallback)
 */

import {
  PredictionResult,
  PredictionConfig,
  PredictionFactor,
  DEFAULT_PREDICTION_CONFIG,
} from '@/types/prediction';
import { TargetVcpu } from '@/types/scaling';
import { getRecentMetrics, getMetricsStats, getMetricsCount } from './metrics-store';
import { getStore } from '@/lib/redis-store';

// Anthropic API Configuration
const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// delete: let lastPredictionTime / lastPrediction (go to store)
```

#### 4.3.2 Modification of `predictScaling()` (lines 209-281)

**Change in-memory variable access in existing code to store access:**

```typescript
export async function predictScaling(
  currentVcpu: number,
  config: PredictionConfig = DEFAULT_PREDICTION_CONFIG
): Promise<PredictionResult | null> {
  const store = getStore();

  // Check rate limiting
  const now = Date.now();
  const lastPredictionTime = await store.getLastPredictionTime();
  if (now - lastPredictionTime < config.predictionCooldownSeconds * 1000) {
    return store.getLastPrediction();
  }

  // Check minimum data points
  const dataPointCount = await getMetricsCount();
  if (dataPointCount < config.minDataPoints) {
    console.log(`Insufficient data for prediction: ${dataPointCount}/${config.minDataPoints} points`);
    return null;
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = await buildUserPrompt(currentVcpu);

  try {
    console.log(`[Predictive Scaler] Requesting prediction from AI Gateway...`);

    const response = await fetch(`${AI_GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANTHROPIC_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'claude-haiku-4.5',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI Gateway responded with ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    const prediction = parseAIResponse(content);

    if (prediction) {
      await store.setLastPredictionTime(now);
      await store.setLastPrediction(prediction);
      return prediction;
    }

    console.warn('AI returned invalid response, using fallback prediction');
    const fallback = await generateFallbackPrediction(currentVcpu);
    await store.setLastPredictionTime(now);
    await store.setLastPrediction(fallback);
    return fallback;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Prediction AI Gateway Error:', errorMessage);

    const fallback = await generateFallbackPrediction(currentVcpu);
    await store.setLastPredictionTime(now);
    await store.setLastPrediction(fallback);
    return fallback;
  }
}
```

#### 4.3.3 `buildUserPrompt()` async conversion (line 71)

```typescript
async function buildUserPrompt(currentVcpu: number): string {
  const metrics = await getRecentMetrics();
  const stats = await getMetricsStats();
// ...the rest is the same
}
```

#### 4.3.4 `generateFallbackPrediction()` async 전환 (line 158)

```typescript
async function generateFallbackPrediction(currentVcpu: number): Promise<PredictionResult> {
  const stats = await getMetricsStats();
// ...the rest is the same
}
```

#### 4.3.5 Utility function modification (lines 287-314)

```typescript
export async function getLastPrediction(): Promise<PredictionResult | null> {
  return getStore().getLastPrediction();
}

export async function canMakePrediction(config: PredictionConfig = DEFAULT_PREDICTION_CONFIG): Promise<boolean> {
  const now = Date.now();
  const lastTime = await getStore().getLastPredictionTime();
  return now - lastTime >= config.predictionCooldownSeconds * 1000;
}

export async function getNextPredictionIn(config: PredictionConfig = DEFAULT_PREDICTION_CONFIG): Promise<number> {
  const now = Date.now();
  const lastTime = await getStore().getLastPredictionTime();
  const elapsed = (now - lastTime) / 1000;
  return Math.max(0, config.predictionCooldownSeconds - elapsed);
}

export async function resetPredictionState(): Promise<void> {
  await getStore().resetPredictionState();
}
```

---

### 4.4 Modify `src/app/api/metrics/route.ts`

#### 4.4.1 Add Import and Remove State Variables

**Edit top of file (lines 1-14):**

```typescript
import { createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { pushMetric } from '@/lib/metrics-store';
import { MetricDataPoint } from '@/types/prediction';
import { runK8sCommand, getNamespace, getAppPrefix } from '@/lib/k8s-config';

// ====== Add here ======
import { getStore } from '@/lib/redis-store';
// ========================

// delete: let lastL2BlockHeight / lastL2BlockTime (move to store)
```

#### 4.4.2 Modify block tracking logic (lines 358-372)

**Old Code:**
```typescript
let blockInterval = 2.0;
if (lastL2BlockHeight !== null && lastL2BlockTime !== null) {
  if (blockNumber > lastL2BlockHeight) {
    const timeDiff = (now - lastL2BlockTime) / 1000;
    const blockDiff = Number(blockNumber - lastL2BlockHeight);
    blockInterval = timeDiff / blockDiff;
  }
}
lastL2BlockHeight = blockNumber;
lastL2BlockTime = now;
```

**change:**
```typescript
let blockInterval = 2.0;
const lastBlock = await getStore().getLastBlock();
if (lastBlock.height !== null && lastBlock.time !== null) {
  const lastHeight = BigInt(lastBlock.height);
  const lastTime = Number(lastBlock.time);
  if (blockNumber > lastHeight) {
    const timeDiff = (now - lastTime) / 1000;
    const blockDiff = Number(blockNumber - lastHeight);
    blockInterval = timeDiff / blockDiff;
  }
}
await getStore().setLastBlock(String(blockNumber), String(now));
```

#### 4.4.3 Modify pushMetric call (line 385)

**Existing:** `pushMetric(dataPoint);`
**변경:** `await pushMetric(dataPoint);`

---

### 4.5 `src/app/api/metrics/seed/route.ts` 수정

#### Add async call

**Add `await` to all metrics-store/predictive-scaler function calls:**

**Near line 142:**
```typescript
// existing
const count = getMetricsCount();
// change
const count = await getMetricsCount();
```

**Near line 155-157:**
```typescript
// existing
resetPredictionState();
const liveData = getRecentMetrics();
// change
await resetPredictionState();
const liveData = await getRecentMetrics();
```

**Near line 174-179:**
```typescript
// existing
clearMetrics();
resetPredictionState();
for (const point of dataPoints) {
  pushMetric(point);
}
// change
await clearMetrics();
await resetPredictionState();
for (const point of dataPoints) {
  await pushMetric(point);
}
```

---

### 4.6 Modify `src/app/api/scaler/route.ts`

#### 4.6.1 Add Import

```typescript
// No additions after existing imports — existing imports are kept
// Function signature is changed to async, so only await is added
```

#### 4.6.2 Modify GET handler (lines 86-146)

Change an existing synchronous call to `await`:

```typescript
export async function GET(_request: NextRequest) {
  try {
const state = await getScalingState();           // await 추가
    const currentVcpu = await getCurrentVcpu();

    if (currentVcpu !== state.currentVcpu) {
await updateScalingState({ // add await
        currentVcpu,
        currentMemoryGiB: (currentVcpu * 2) as 2 | 4 | 8,
      });
    }

let prediction: PredictionResult | null = await getLastPrediction();  // await 추가
const metricsCount = await getMetricsCount();    // await 추가

    if (metricsCount >= DEFAULT_PREDICTION_CONFIG.minDataPoints) {
      const newPrediction = await predictScaling(currentVcpu);
      if (newPrediction) {
        prediction = newPrediction;
      }
    }

// ... predictionInfo configuration (same)

    return NextResponse.json({
...(await getScalingState()), // add await
simulationMode: await isSimulationMode(), // await addition
      timestamp: new Date().toISOString(),
      prediction: predictionInfo,
      predictionMeta: {
        metricsCount,
        minRequired: DEFAULT_PREDICTION_CONFIG.minDataPoints,
nextPredictionIn: await getNextPredictionIn(),  // await 추가
        isReady: metricsCount >= DEFAULT_PREDICTION_CONFIG.minDataPoints,
      },
    });
  } catch (error) {
// ... error handling (same)
  }
}
```

#### 4.6.3 Modify POST handler (lines 151-281)

```typescript
// line 185: Existing synchronous call → await
if (!(await isAutoScalingEnabled())) {       // await 추가

// line 267: Existing synchronous call → await
cooldownRemaining: (await getScalingState()).cooldownRemaining,  // await 추가
```

#### 4.6.4 Modify PATCH handler (lines 286-312)

```typescript
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { autoScalingEnabled, simulationMode } = body;

    if (typeof autoScalingEnabled === 'boolean') {
await setAutoScalingEnabled(autoScalingEnabled);    // await 추가
    }

    if (typeof simulationMode === 'boolean') {
await setSimulationMode(simulationMode);            // add await
    }

    return NextResponse.json({
      success: true,
autoScalingEnabled: await isAutoScalingEnabled(),   // await 추가
simulationMode: await isSimulationMode(), // await addition
    });
  } catch (error) {
// ... error handling (same)
  }
}
```

---

## 5. API 명세 (API Specification)

### 5.1 External API changes — None

Request/response formats for all API endpoints (`/api/metrics`, `/api/scaler`, `/api/metrics/seed`, `/api/health`) are **unchanged**. The introduction of Redis is an internal storage replacement, so it does not affect the external interface.

### 5.2 Internal function signature change

| module | function | existing | change |
|------|------|------|------|
| metrics-store | `pushMetric` | `(dp) => void` | `(dp) => Promise<void>` |
| metrics-store | `getRecentMetrics` | `(n?) => MetricDataPoint[]` | `(n?) => Promise<MetricDataPoint[]>` |
| metrics-store | `getMetricsStats` | `() => MetricsStoreStats` | `() => Promise<MetricsStoreStats>` |
| metrics-store | `clearMetrics` | `() => void` | `() => Promise<void>` |
| metrics-store | `getMetricsCount` | `() => number` | `() => Promise<number>` |
| k8s-scaler | `isSimulationMode` | `() => boolean` | `() => Promise<boolean>` |
| k8s-scaler | `setSimulationMode` | `(b) => void` | `(b) => Promise<void>` |
| k8s-scaler | `getSimulationConfig` | `() => SimulationConfig` | `() => Promise<SimulationConfig>` |
| k8s-scaler | `checkCooldown` | `(c?) => {..}` | `(c?) => Promise<{..}>` |
| k8s-scaler | `getScalingState` | `(c?) => ScalingState` | `(c?) => Promise<ScalingState>` |
| k8s-scaler | `updateScalingState` | `(u) => void` | `(u) => Promise<void>` |
| k8s-scaler | `addScalingHistory` | `(e) => void` | `(e) => Promise<void>` |
| k8s-scaler | `getScalingHistory` | `(l?) => Entry[]` | `(l?) => Promise<Entry[]>` |
| k8s-scaler | `setAutoScalingEnabled` | `(b) => void` | `(b) => Promise<void>` |
| k8s-scaler | `isAutoScalingEnabled` | `() => boolean` | `() => Promise<boolean>` |
| predictive-scaler | `getLastPrediction` | `() => Result \| null` | `() => Promise<Result \| null>` |
| predictive-scaler | `canMakePrediction` | `(c?) => boolean` | `(c?) => Promise<boolean>` |
| predictive-scaler | `getNextPredictionIn` | `(c?) => number` | `(c?) => Promise<number>` |
| predictive-scaler | `resetPredictionState` | `() => void` | `() => Promise<void>` |

---

## 6. Environment Variables

| variable | Use | Required | default |
|------|------|:----:|--------|
| `REDIS_URL` | Redis connection URL | No | InMemory mode when not set |

### Add `.env.local.sample`

```bash
# State Store (Optional - defaults to in-memory if not set)
# REDIS_URL=redis://localhost:6379
```

### When running Docker

```bash
# Run with Redis
docker run -d \
  --name sentinai \
  -p 3000:3000 \
  -e L2_RPC_URL=https://your-l2-rpc-endpoint.com \
  -e REDIS_URL=redis://your-redis-host:6379 \
  sentinai:latest
```

### Docker Compose Example

```yaml
services:
  sentinai:
    build: .
    ports:
      - "3000:3000"
    environment:
      - L2_RPC_URL=https://your-l2-rpc-endpoint.com
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

---

## 7. Test Verification

### 7.1 InMemory mode verification (Redis not set)

Verify that the existing behavior is 100% maintained without `REDIS_URL` set:

```bash
# 1. Build & run without Redis
npm run build && npm run start

# 2. Verify metrics collection
curl http://localhost:3002/api/metrics | jq '.metrics.cpuUsage'

# 3. Seed data injection
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=rising"

# 4. Check scaling status
curl http://localhost:3002/api/scaler | jq '.currentVcpu'

# 5. Manual scaling (simulation mode)
curl -X POST http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"targetVcpu": 2}'
```

### 7.2 Redis mode verification

```bash
# 1. Getting started with Redis
docker run -d --name redis -p 6379:6379 redis:7-alpine

# 2. Run after setting REDIS_URL
REDIS_URL=redis://localhost:6379 npm run dev

# 3. Check Redis after collecting metrics
redis-cli LLEN sentinai:metrics:buffer
# Expected: 1 or more

# 4. Make sure state is maintained after server restart
# Shut down and restart the server with Ctrl+C
REDIS_URL=redis://localhost:6379 npm run dev

# 5. Check data retention
curl http://localhost:3002/api/scaler | jq '.currentVcpu'
# Expected: Same value as before restart
```

### 7.3 Redis connection failure scenario

```bash
# 1. Setting up a non-existent Redis
REDIS_URL=redis://nonexistent:6379 npm run dev

# 2. Check whether the server startup failed → An error log is output, but the server must be started.
# Switch to error event after ioredis's retryStrategy returns null

# 3. The default action is to return an error (when Redis connection fails)
```

### 7.4 Edge Cases

| case | Expected Behavior |
|--------|-----------|
| `REDIS_URL` not set | Use InMemoryStateStore, maintain 100% existing behavior |
| Dropped after connecting to Redis | ioredis Automatic reconnection attempt, request before reconnection results in error |
| Existing key exists in Redis | Automatically restore existing data when server starts |
| Added 61 metrics | Keep up to 60 with LTRIM (delete the oldest) |
| 51 scaling histories | Maintain up to 50 with LTRIM |
| Predictive Cache TTL Expiration | `getLastPrediction()` → returns `null` |
| `npm run build` | Pass TypeScript strict mode (all async/await types are consistent) |

---

## 8. Dependencies

### 8.1 npm package

```bash
npm install ioredis
npm install -D @types/ioredis # ioredis 5.x provides built-in types, may be unnecessary
```

> **Note**: ioredis 5.x has built-in TypeScript types, so `@types/ioredis` may be unnecessary. Check when installing.

### 8.2 Proposal dependency

| Proposal | relationship | Description |
|----------|------|------|
| Proposal 1 (Predictive Scaling) | **To be modified** | `metrics-store.ts`, `predictive-scaler.ts` async conversion |
| Proposal 2-5 | No impact | Not implemented yet |
| Proposal 6 (Zero-Downtime) | No impact | Architecture documentation, no code changes |

### 8.3 Implementation order

1. Install `ioredis` package
2. Create `src/types/redis.ts`
3. Create `src/lib/redis-store.ts`
4. Replace `src/lib/metrics-store.ts`
5. Replace `src/lib/k8s-scaler.ts`
6. Modify `src/lib/predictive-scaler.ts`
7. Modify `src/app/api/metrics/route.ts`
8. `src/app/api/metrics/seed/route.ts` 수정
9. Modify `src/app/api/scaler/route.ts`
10. Check `npm run build`
11. Update `.env.local.sample`

---

## 9. Checklist (Implementation Checklist)

- [ ] Run `npm install ioredis`
- [ ] Create `src/types/redis.ts` — `IStateStore` interface
- [ ] `src/lib/redis-store.ts` created - `RedisStateStore`, `InMemoryStateStore`, `getStore()`
- [ ] Replace `src/lib/metrics-store.ts` — former function async, uses `getStore()`
- [ ] Replace `src/lib/k8s-scaler.ts` — remove all functions async, in-memory state
- [ ] Modify `src/lib/predictive-scaler.ts` — remove in-memory cache, use `getStore()`
- [ ] Modify `src/app/api/metrics/route.ts` — Remove `lastL2Block*`, add `await`
- [ ] Modify `src/app/api/metrics/seed/route.ts` — Add `await`
- [ ] Modify `src/app/api/scaler/route.ts` — Add `await`
- [ ] Add `REDIS_URL` to `.env.local.sample`
- [ ] TypeScript strict mode no errors
- [ ] `npm run lint` passed
- [ ] `npm run build` success
- [ ] When `REDIS_URL` is not set, check to maintain 100% existing operation.
- [ ] Check state persistence when connecting to Redis (data maintained after server restart)

---

## Appendix: File Structure

```
src/
├── types/
│ ├── redis.ts # nyc — IStateStore, RedisConfig
│ ├── scaling.ts # No change
│ └── prediction.ts # No change
├── lib/
│ ├── redis-store.ts # nyc — RedisStateStore, InMemoryStateStore, getStore()
│ ├── metrics-store.ts # Modify — switch to async, use getStore()
│ ├── k8s-scaler.ts # Modify — switch to async, remove in-memory state
│ ├── predictive-scaler.ts # Edit — switch to async, move cache store
│ ├── k8s-config.ts # No change
│ ├── scaling-decision.ts # No change
│ └── ai-analyzer.ts # No change
├── app/
│   ├── api/
│   │   ├── metrics/
│ │ │ ├── route.ts # Edit — Move lastBlock store, add await
│   │   │   └── seed/
│ │ │ └── route.ts # Edit — Add await
│   │   ├── scaler/
│ │ │ └── route.ts # Edit — Add await
│   │   └── health/
│ │ └── route.ts # No change
│ └── page.tsx # No change
```

### Summary of Redis key structure

```
sentinai:
├── metrics:
│   ├── buffer            List[60]    MetricDataPoint JSON
│   └── lastblock         Hash        { height, time }
├── scaling:
│   ├── state             Hash        { currentVcpu, currentMemoryGiB, lastScalingTime, ... }
│   ├── history           List[50]    ScalingHistoryEntry JSON
│   └── simulation        Hash        { enabled, mockCurrentVcpu }
└── prediction:
    ├── latest            String      PredictionResult JSON (TTL 300s)
    └── time              String      Unix timestamp ms
```

---

*End of document*
