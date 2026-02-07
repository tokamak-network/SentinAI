# Proposal 7: Redis State Store (상태 영속성 계층)

## 문서 정보

| 항목 | 내용 |
|------|------|
| 버전 | 1.0.0 |
| 작성일 | 2026-02-06 |
| 대상 | Claude Opus 4.6 구현 에이전트 |
| 의존성 | Proposal 1 (MetricsStore, PredictiveScaler) — 기존 구현 수정 |

---

## 1. 개요 (Overview)

### 1.1 기능 요약

SentinAI의 모든 인메모리 상태를 Redis로 마이그레이션하여 **서버 재시작 시 상태 유지**, **다중 인스턴스 간 상태 공유**를 달성하는 영속성 계층이다.

### 1.2 해결하는 문제

현재 SentinAI의 모든 런타임 상태가 Node.js 프로세스 메모리에 저장되어 있다:

1. **상태 소실**: 서버 재시작, 재배포, 컨테이너 재생성 시 메트릭(최대 1시간분), 스케일링 이력(50건), 예측 캐시가 전부 소실된다.
2. **인스턴스 불일치**: 로드 밸런서 뒤에 복수 인스턴스 배치 시 각 인스턴스가 독립된 상태를 가진다. 인스턴스 A에서 스케일링이 발생해도 인스턴스 B는 인지하지 못한다.
3. **코드 내 인지**: `src/lib/k8s-scaler.ts` line 24에 `// Recommended to use Redis or DB in actual production` 주석이 존재하며, 현재 인메모리 방식의 한계를 스스로 인지하고 있다.

### 1.3 핵심 가치

- **무상태 서버**: 애플리케이션 서버가 상태를 갖지 않아 자유로운 스케일아웃/재시작 가능
- **상태 영속성**: 프로세스 생명주기와 무관하게 메트릭, 스케일링 상태, 예측 캐시 보존
- **점진적 도입**: `REDIS_URL` 미설정 시 기존 인메모리 동작을 100% 유지하는 Strategy Pattern

### 1.4 의존 관계

- **Proposal 1** (Predictive Scaling): `metrics-store.ts`, `predictive-scaler.ts` 수정 — 이미 구현 완료된 코드를 async로 전환
- **npm 패키지**: `ioredis` (신규 의존성)

---

## 2. 타입 정의 (Type Definitions)

### 2.1 신규 파일: `src/types/redis.ts`

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

## 3. 신규 파일 명세 (New Files)

### 3.1 `src/lib/redis-store.ts` (핵심 모듈)

#### 전체 구현 코드

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

#### 함수 시그니처 요약

| 함수 | 입력 | 출력 | 설명 |
|------|------|------|------|
| `getStore()` | - | `IStateStore` | 싱글톤 스토어 인스턴스 반환 |
| `resetStore()` | - | `Promise<void>` | 스토어 리셋 (테스트용) |
| `store.pushMetric(dp)` | `MetricDataPoint` | `Promise<void>` | 메트릭 추가 (RPUSH + LTRIM 60) |
| `store.getRecentMetrics(n?)` | `number?` | `Promise<MetricDataPoint[]>` | 최근 N개 메트릭 조회 |
| `store.clearMetrics()` | - | `Promise<void>` | 메트릭 버퍼 초기화 |
| `store.getMetricsCount()` | - | `Promise<number>` | 현재 메트릭 수 |
| `store.getScalingState()` | - | `Promise<ScalingState>` | 스케일링 상태 조회 |
| `store.updateScalingState(u)` | `Partial<ScalingState>` | `Promise<void>` | 스케일링 상태 업데이트 |
| `store.addScalingHistory(e)` | `ScalingHistoryEntry` | `Promise<void>` | 이력 추가 (LPUSH + LTRIM 50) |
| `store.getScalingHistory(n?)` | `number?` | `Promise<ScalingHistoryEntry[]>` | 이력 조회 |
| `store.getSimulationConfig()` | - | `Promise<SimulationConfig>` | 시뮬레이션 설정 조회 |
| `store.setSimulationConfig(c)` | `Partial<SimulationConfig>` | `Promise<void>` | 시뮬레이션 설정 변경 |
| `store.getLastPrediction()` | - | `Promise<PredictionResult \| null>` | 캐시된 예측 조회 |
| `store.setLastPrediction(p)` | `PredictionResult` | `Promise<void>` | 예측 캐시 저장 (TTL 300s) |
| `store.getLastPredictionTime()` | - | `Promise<number>` | 마지막 예측 시간 |
| `store.setLastPredictionTime(t)` | `number` | `Promise<void>` | 예측 시간 저장 |
| `store.resetPredictionState()` | - | `Promise<void>` | 예측 캐시/시간 초기화 |
| `store.getLastBlock()` | - | `Promise<{height, time}>` | 마지막 블록 정보 |
| `store.setLastBlock(h, t)` | `string, string` | `Promise<void>` | 블록 정보 저장 |

---

## 4. 기존 파일 수정 (Existing File Modifications)

### 4.1 `src/lib/metrics-store.ts` 수정 — 전체 교체

기존 인메모리 배열을 `getStore()`로 교체하고 모든 함수를 async로 전환한다.

#### 전체 교체 코드

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

### 4.2 `src/lib/k8s-scaler.ts` 수정 — 전체 교체

인메모리 상태 변수를 `getStore()`로 교체하고, 상태 접근 함수를 async로 전환한다.

#### 전체 교체 코드

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

### 4.3 `src/lib/predictive-scaler.ts` 수정

#### 4.3.1 Import 수정 및 상태 변수 제거

**파일 상단 (lines 1-21) 교체**

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

// 삭제: let lastPredictionTime / lastPrediction (store로 이동)
```

#### 4.3.2 `predictScaling()` 수정 (line 209-281)

**기존 코드의 인메모리 변수 접근을 store 접근으로 변경:**

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

#### 4.3.3 `buildUserPrompt()` async 전환 (line 71)

```typescript
async function buildUserPrompt(currentVcpu: number): string {
  const metrics = await getRecentMetrics();
  const stats = await getMetricsStats();
  // ... 나머지 동일
}
```

#### 4.3.4 `generateFallbackPrediction()` async 전환 (line 158)

```typescript
async function generateFallbackPrediction(currentVcpu: number): Promise<PredictionResult> {
  const stats = await getMetricsStats();
  // ... 나머지 동일
}
```

#### 4.3.5 유틸리티 함수 수정 (lines 287-314)

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

### 4.4 `src/app/api/metrics/route.ts` 수정

#### 4.4.1 Import 추가 및 상태 변수 제거

**파일 상단 (lines 1-14) 수정:**

```typescript
import { createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { pushMetric } from '@/lib/metrics-store';
import { MetricDataPoint } from '@/types/prediction';
import { runK8sCommand, getNamespace, getAppPrefix } from '@/lib/k8s-config';

// ====== 여기에 추가 ======
import { getStore } from '@/lib/redis-store';
// ========================

// 삭제: let lastL2BlockHeight / lastL2BlockTime (store로 이동)
```

#### 4.4.2 블록 추적 로직 수정 (lines 358-372)

**기존 코드:**
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

**변경:**
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

#### 4.4.3 pushMetric 호출 수정 (line 385)

**기존:** `pushMetric(dataPoint);`
**변경:** `await pushMetric(dataPoint);`

---

### 4.5 `src/app/api/metrics/seed/route.ts` 수정

#### async 호출 추가

**모든 metrics-store/predictive-scaler 함수 호출에 `await` 추가:**

**line 142 근처:**
```typescript
// 기존
const count = getMetricsCount();
// 변경
const count = await getMetricsCount();
```

**line 155-157 근처:**
```typescript
// 기존
resetPredictionState();
const liveData = getRecentMetrics();
// 변경
await resetPredictionState();
const liveData = await getRecentMetrics();
```

**line 174-179 근처:**
```typescript
// 기존
clearMetrics();
resetPredictionState();
for (const point of dataPoints) {
  pushMetric(point);
}
// 변경
await clearMetrics();
await resetPredictionState();
for (const point of dataPoints) {
  await pushMetric(point);
}
```

---

### 4.6 `src/app/api/scaler/route.ts` 수정

#### 4.6.1 Import 추가

```typescript
// 기존 import 뒤에 추가 없음 — 기존 import는 유지
// 함수 시그니처가 async로 바뀌므로 await만 추가
```

#### 4.6.2 GET 핸들러 수정 (line 86-146)

기존 동기 호출을 `await`로 변경:

```typescript
export async function GET(_request: NextRequest) {
  try {
    const state = await getScalingState();           // await 추가
    const currentVcpu = await getCurrentVcpu();

    if (currentVcpu !== state.currentVcpu) {
      await updateScalingState({                     // await 추가
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

    // ... predictionInfo 구성 (동일)

    return NextResponse.json({
      ...(await getScalingState()),                  // await 추가
      simulationMode: await isSimulationMode(),      // await 추가
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
    // ... 에러 처리 (동일)
  }
}
```

#### 4.6.3 POST 핸들러 수정 (line 151-281)

```typescript
// line 185: 기존 동기 호출 → await
if (!(await isAutoScalingEnabled())) {       // await 추가

// line 267: 기존 동기 호출 → await
cooldownRemaining: (await getScalingState()).cooldownRemaining,  // await 추가
```

#### 4.6.4 PATCH 핸들러 수정 (line 286-312)

```typescript
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { autoScalingEnabled, simulationMode } = body;

    if (typeof autoScalingEnabled === 'boolean') {
      await setAutoScalingEnabled(autoScalingEnabled);    // await 추가
    }

    if (typeof simulationMode === 'boolean') {
      await setSimulationMode(simulationMode);            // await 추가
    }

    return NextResponse.json({
      success: true,
      autoScalingEnabled: await isAutoScalingEnabled(),   // await 추가
      simulationMode: await isSimulationMode(),           // await 추가
    });
  } catch (error) {
    // ... 에러 처리 (동일)
  }
}
```

---

## 5. API 명세 (API Specification)

### 5.1 외부 API 변경 — 없음

모든 API 엔드포인트(`/api/metrics`, `/api/scaler`, `/api/metrics/seed`, `/api/health`)의 요청/응답 형식은 **변경 없음**. Redis 도입은 내부 저장소 교체이므로 외부 인터페이스에 영향을 주지 않는다.

### 5.2 내부 함수 시그니처 변경

| 모듈 | 함수 | 기존 | 변경 |
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

## 6. 환경 변수 (Environment Variables)

| 변수 | 용도 | 필수 | 기본값 |
|------|------|:----:|--------|
| `REDIS_URL` | Redis 연결 URL | 아니오 | 미설정 시 InMemory 모드 |

### `.env.local.sample` 추가

```bash
# State Store (Optional - defaults to in-memory if not set)
# REDIS_URL=redis://localhost:6379
```

### Docker 실행 시

```bash
# Redis 포함 실행
docker run -d \
  --name sentinai \
  -p 3000:3000 \
  -e L2_RPC_URL=https://your-l2-rpc-endpoint.com \
  -e REDIS_URL=redis://your-redis-host:6379 \
  sentinai:latest
```

### Docker Compose 예시

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

## 7. 테스트 검증 (Verification)

### 7.1 InMemory 모드 검증 (Redis 미설정)

`REDIS_URL`을 설정하지 않은 상태에서 기존 동작이 100% 유지되는지 확인:

```bash
# 1. Redis 없이 빌드 & 실행
npm run build && npm run start

# 2. 메트릭 수집 확인
curl http://localhost:3002/api/metrics | jq '.metrics.cpuUsage'

# 3. Seed 데이터 주입
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=rising"

# 4. 스케일링 상태 확인
curl http://localhost:3002/api/scaler | jq '.currentVcpu'

# 5. 수동 스케일링 (시뮬레이션 모드)
curl -X POST http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"targetVcpu": 2}'
```

### 7.2 Redis 모드 검증

```bash
# 1. Redis 시작
docker run -d --name redis -p 6379:6379 redis:7-alpine

# 2. REDIS_URL 설정 후 실행
REDIS_URL=redis://localhost:6379 npm run dev

# 3. 메트릭 수집 후 Redis 확인
redis-cli LLEN sentinai:metrics:buffer
# 예상: 1 이상

# 4. 서버 재시작 후 상태 유지 확인
# Ctrl+C로 서버 종료 후 재시작
REDIS_URL=redis://localhost:6379 npm run dev

# 5. 데이터 보존 확인
curl http://localhost:3002/api/scaler | jq '.currentVcpu'
# 예상: 재시작 전과 동일한 값
```

### 7.3 Redis 연결 실패 시나리오

```bash
# 1. 존재하지 않는 Redis로 설정
REDIS_URL=redis://nonexistent:6379 npm run dev

# 2. 서버 시작 실패 여부 확인 → 에러 로그는 출력되나 서버는 시작되어야 함
# ioredis의 retryStrategy가 null 반환 후 에러 이벤트로 전환

# 3. 기본 동작은 에러를 반환 (Redis 연결 실패 시)
```

### 7.4 Edge Cases

| 케이스 | 예상 동작 |
|--------|-----------|
| `REDIS_URL` 미설정 | InMemoryStateStore 사용, 기존 동작 100% 유지 |
| Redis 연결 후 끊김 | ioredis 자동 재연결 시도, 재연결 전 요청은 에러 |
| Redis에 기존 키 존재 | 서버 시작 시 기존 데이터 자동 복원 |
| 메트릭 61개 추가 | LTRIM으로 최대 60개 유지 (가장 오래된 것 삭제) |
| 스케일링 이력 51개 | LTRIM으로 최대 50개 유지 |
| 예측 캐시 TTL 만료 | `getLastPrediction()` → `null` 반환 |
| `npm run build` | TypeScript strict 모드 통과 (모든 async/await 타입 일관성) |

---

## 8. 의존 관계 (Dependencies)

### 8.1 npm 패키지

```bash
npm install ioredis
npm install -D @types/ioredis  # ioredis 5.x는 내장 타입 제공, 불필요할 수 있음
```

> **참고**: ioredis 5.x는 TypeScript 타입을 내장하고 있으므로 `@types/ioredis`는 불필요할 수 있다. 설치 시 확인할 것.

### 8.2 Proposal 의존성

| Proposal | 관계 | 설명 |
|----------|------|------|
| Proposal 1 (Predictive Scaling) | **수정 대상** | `metrics-store.ts`, `predictive-scaler.ts` async 전환 |
| Proposal 2-5 | 영향 없음 | 아직 미구현 |
| Proposal 6 (Zero-Downtime) | 영향 없음 | 아키텍처 문서, 코드 변경 없음 |

### 8.3 구현 순서

1. `ioredis` 패키지 설치
2. `src/types/redis.ts` 생성
3. `src/lib/redis-store.ts` 생성
4. `src/lib/metrics-store.ts` 교체
5. `src/lib/k8s-scaler.ts` 교체
6. `src/lib/predictive-scaler.ts` 수정
7. `src/app/api/metrics/route.ts` 수정
8. `src/app/api/metrics/seed/route.ts` 수정
9. `src/app/api/scaler/route.ts` 수정
10. `npm run build` 확인
11. `.env.local.sample` 업데이트

---

## 9. 체크리스트 (Implementation Checklist)

- [ ] `npm install ioredis` 실행
- [ ] `src/types/redis.ts` 생성 — `IStateStore` 인터페이스
- [ ] `src/lib/redis-store.ts` 생성 — `RedisStateStore`, `InMemoryStateStore`, `getStore()`
- [ ] `src/lib/metrics-store.ts` 교체 — 전 함수 async, `getStore()` 사용
- [ ] `src/lib/k8s-scaler.ts` 교체 — 전 함수 async, 인메모리 상태 제거
- [ ] `src/lib/predictive-scaler.ts` 수정 — 인메모리 캐시 제거, `getStore()` 사용
- [ ] `src/app/api/metrics/route.ts` 수정 — `lastL2Block*` 제거, `await` 추가
- [ ] `src/app/api/metrics/seed/route.ts` 수정 — `await` 추가
- [ ] `src/app/api/scaler/route.ts` 수정 — `await` 추가
- [ ] `.env.local.sample`에 `REDIS_URL` 추가
- [ ] TypeScript strict mode 오류 없음
- [ ] `npm run lint` 통과
- [ ] `npm run build` 성공
- [ ] `REDIS_URL` 미설정 시 기존 동작 100% 유지 확인
- [ ] Redis 연결 시 상태 영속성 확인 (서버 재시작 후 데이터 유지)

---

## 부록: 파일 구조

```
src/
├── types/
│   ├── redis.ts           # 신규 — IStateStore, RedisConfig
│   ├── scaling.ts         # 변경 없음
│   └── prediction.ts      # 변경 없음
├── lib/
│   ├── redis-store.ts     # 신규 — RedisStateStore, InMemoryStateStore, getStore()
│   ├── metrics-store.ts   # 수정 — async 전환, getStore() 사용
│   ├── k8s-scaler.ts      # 수정 — async 전환, 인메모리 상태 제거
│   ├── predictive-scaler.ts # 수정 — async 전환, 캐시 store 이동
│   ├── k8s-config.ts      # 변경 없음
│   ├── scaling-decision.ts # 변경 없음
│   └── ai-analyzer.ts     # 변경 없음
├── app/
│   ├── api/
│   │   ├── metrics/
│   │   │   ├── route.ts   # 수정 — lastBlock store 이동, await 추가
│   │   │   └── seed/
│   │   │       └── route.ts # 수정 — await 추가
│   │   ├── scaler/
│   │   │   └── route.ts   # 수정 — await 추가
│   │   └── health/
│   │       └── route.ts   # 변경 없음
│   └── page.tsx           # 변경 없음
```

### Redis 키 구조 요약

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

*문서 끝*
