# Proposal 1: Predictive Scaling (예측 기반 스케일링)

## 문서 정보

| 항목 | 내용 |
|------|------|
| 버전 | 1.0.0 |
| 작성일 | 2026-02-06 |
| 대상 | Claude Opus 4.6 구현 에이전트 |
| 의존성 | 없음 (독립 구현 가능) |

---

## 1. 개요 (Overview)

### 1.1 기능 요약

Predictive Scaling은 과거 메트릭 데이터의 시계열 패턴을 AI가 분석하여 **향후 부하를 예측**하고, 실제 부하가 발생하기 **전에 선제적으로 스케일링**을 수행하는 기능이다.

### 1.2 해결하는 문제

현재 SentinAI의 스케일링 로직(`src/lib/scaling-decision.ts`)은 **현재 시점의 메트릭**만을 기반으로 결정을 내린다. 이로 인해:

1. **반응형 스케일링의 한계**: 부하가 급증한 후에야 스케일업이 시작되어 사용자 경험 저하
2. **쿨다운 지연**: 5분 쿨다운 동안 추가 스케일링 불가
3. **예측 가능한 패턴 미활용**: 일간/주간 트래픽 패턴을 학습하지 않음

### 1.3 핵심 가치

- **선제적 스케일링**: 부하 발생 5분 전에 리소스 확보
- **비용 최적화**: 불필요한 오버프로비저닝 방지
- **신뢰도 기반 의사결정**: AI 예측의 confidence가 임계값(0.7) 이상일 때만 실행

### 1.4 의존 관계

이 제안서는 **독립적으로 구현 가능**하다. 단, `MetricsStore` 모듈은 향후 Proposal 2, 3, 4에서도 공유 사용될 예정이므로, 확장성을 고려한 설계가 필요하다.

---

## 2. 타입 정의 (Type Definitions)

### 2.1 신규 파일: `src/types/prediction.ts`

```typescript
/**
 * Predictive Scaling Types
 * AI-based preemptive scaling with time-series analysis
 */

import { TargetVcpu, AISeverity } from './scaling';

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
```

---

## 3. 신규 파일 명세 (New Files)

### 3.1 `src/lib/metrics-store.ts` (공유 모듈)

이 모듈은 시계열 메트릭 데이터를 관리하는 **Ring Buffer**를 구현한다. 메모리 효율성을 위해 최대 60개의 데이터 포인트만 유지한다 (1분 간격 수집 시 1시간 분량).

#### 전체 구현 코드

```typescript
/**
 * Metrics Store Module
 * Ring buffer implementation for time-series metric storage
 * Shared across Predictive Scaling, Anomaly Detection, and Analytics
 */

import { MetricDataPoint, MetricsStoreStats, MetricStatSummary } from '@/types/prediction';

/** Maximum number of data points to store (1 hour at 1-minute intervals) */
const MAX_DATA_POINTS = 60;

/** Threshold for trend detection: slope magnitude below this is "stable" */
const TREND_THRESHOLD = 0.5;

/** In-memory ring buffer storage */
let metricsBuffer: MetricDataPoint[] = [];

/**
 * Push a new data point to the metrics store
 * Automatically evicts oldest data if buffer is full
 *
 * @param dataPoint - The metric data point to store
 */
export function pushMetric(dataPoint: MetricDataPoint): void {
  metricsBuffer.push(dataPoint);

  // Evict oldest if over capacity
  if (metricsBuffer.length > MAX_DATA_POINTS) {
    metricsBuffer = metricsBuffer.slice(-MAX_DATA_POINTS);
  }
}

/**
 * Get recent data points from the store
 *
 * @param count - Number of recent points to retrieve (default: all)
 * @returns Array of data points, newest last
 */
export function getRecentMetrics(count?: number): MetricDataPoint[] {
  if (count === undefined || count >= metricsBuffer.length) {
    return [...metricsBuffer];
  }
  return metricsBuffer.slice(-count);
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

  // Mean
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

  // Standard Deviation
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  const stdDev = Math.sqrt(variance);

  // Min/Max
  const min = Math.min(...values);
  const max = Math.max(...values);

  // Linear Regression for Trend Detection
  // Using least squares method: slope = Σ((x - x̄)(y - ȳ)) / Σ((x - x̄)²)
  const n = values.length;
  const xMean = (n - 1) / 2; // x values are 0, 1, 2, ... n-1

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    const xDiff = i - xMean;
    const yDiff = values[i] - mean;
    numerator += xDiff * yDiff;
    denominator += xDiff * xDiff;
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;

  // Determine trend based on slope magnitude
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
 *
 * @returns Statistics including count, time range, and per-metric summaries
 */
export function getMetricsStats(): MetricsStoreStats {
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
 * Useful for testing or resetting state
 */
export function clearMetrics(): void {
  metricsBuffer = [];
}

/**
 * Get current buffer size
 *
 * @returns Number of data points currently stored
 */
export function getMetricsCount(): number {
  return metricsBuffer.length;
}

/**
 * Export buffer capacity constant for external use
 */
export const METRICS_BUFFER_CAPACITY = MAX_DATA_POINTS;
```

#### 함수 시그니처 요약

| 함수 | 입력 | 출력 | 설명 |
|------|------|------|------|
| `pushMetric(dataPoint)` | `MetricDataPoint` | `void` | 새 데이터 포인트 추가, 60개 초과 시 가장 오래된 데이터 제거 |
| `getRecentMetrics(count?)` | `number \| undefined` | `MetricDataPoint[]` | 최근 N개 데이터 반환 (기본: 전체) |
| `getMetricsStats()` | - | `MetricsStoreStats` | 통계 요약 (평균, 표준편차, 추세) |
| `clearMetrics()` | - | `void` | 버퍼 초기화 |
| `getMetricsCount()` | - | `number` | 현재 저장된 데이터 포인트 수 |

---

### 3.2 `src/lib/predictive-scaler.ts`

AI를 활용하여 시계열 데이터를 분석하고 향후 스케일링 필요성을 예측하는 모듈이다.

#### 전체 구현 코드

```typescript
/**
 * Predictive Scaler Module
 * AI-powered time-series analysis for preemptive scaling decisions
 */

import {
  PredictionResult,
  PredictionConfig,
  PredictionFactor,
  DEFAULT_PREDICTION_CONFIG,
} from '@/types/prediction';
import { TargetVcpu } from '@/types/scaling';
import { getRecentMetrics, getMetricsStats, getMetricsCount } from './metrics-store';

// AI Gateway Configuration (Same as ai-analyzer.ts)
const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

// Rate limiting state
let lastPredictionTime: number = 0;
let lastPrediction: PredictionResult | null = null;

/**
 * Build the system prompt for prediction AI
 */
function buildSystemPrompt(): string {
  return `You are an expert Site Reliability Engineer specializing in Kubernetes auto-scaling for Optimism L2 blockchain nodes.

Your task is to analyze time-series metrics and predict the optimal vCPU allocation for the next 5 minutes.

CONTEXT:
- Target: op-geth (Optimism Execution Client) running on AWS Fargate
- vCPU options: 1, 2, or 4 vCPU (memory is always vCPU × 2 GiB)
- Current scaling is reactive; you must predict AHEAD of load spikes
- Cost optimization is important: avoid over-provisioning

ANALYSIS FACTORS:
1. CPU Usage Trend: Rising trend suggests upcoming load
2. TxPool Pending: High pending txs indicate batch processing ahead
3. Gas Usage Ratio: Reflects EVM computation intensity
4. Block Interval: Shorter intervals mean faster chain, higher resource needs
5. Time Patterns: Consider time-of-day patterns if visible in data

DECISION RULES:
- Stable low load (CPU < 30%, TxPool < 50): Recommend 1 vCPU
- Moderate or rising load: Recommend 2 vCPU
- High load or spike incoming: Recommend 4 vCPU
- When in doubt, prioritize availability over cost

OUTPUT FORMAT:
Return ONLY a valid JSON object (no markdown, no explanation outside JSON):
{
  "predictedVcpu": 1 | 2 | 4,
  "confidence": 0.0 to 1.0,
  "trend": "rising" | "falling" | "stable",
  "reasoning": "Brief explanation of prediction logic",
  "recommendedAction": "scale_up" | "scale_down" | "maintain",
  "factors": [
    { "name": "factorName", "impact": -1.0 to 1.0, "description": "explanation" }
  ]
}`;
}

/**
 * Build the user prompt with actual metrics data
 */
function buildUserPrompt(currentVcpu: number): string {
  const metrics = getRecentMetrics();
  const stats = getMetricsStats();

  // Format recent metrics as a table for better AI comprehension
  const metricsTable = metrics.slice(-15).map(m => ({
    time: new Date(m.timestamp).toLocaleTimeString('en-US', { hour12: false }),
    cpu: m.cpuUsage.toFixed(1),
    txPool: m.txPoolPending,
    gas: (m.gasUsedRatio * 100).toFixed(1),
    blockInterval: m.blockInterval.toFixed(1),
    vcpu: m.currentVcpu,
  }));

  return `CURRENT STATE:
- Current vCPU: ${currentVcpu}
- Data points available: ${stats.count}
- Time range: ${stats.oldestTimestamp ? new Date(stats.oldestTimestamp).toLocaleTimeString('en-US', { hour12: false }) : 'N/A'} to ${stats.newestTimestamp ? new Date(stats.newestTimestamp).toLocaleTimeString('en-US', { hour12: false }) : 'N/A'}

STATISTICAL SUMMARY (Last ${stats.count} minutes):
- CPU: mean=${stats.stats.cpu.mean}%, stdDev=${stats.stats.cpu.stdDev}, trend=${stats.stats.cpu.trend}, slope=${stats.stats.cpu.slope}
- TxPool: mean=${stats.stats.txPool.mean}, stdDev=${stats.stats.txPool.stdDev}, trend=${stats.stats.txPool.trend}, slope=${stats.stats.txPool.slope}
- Gas Ratio: mean=${(stats.stats.gasUsedRatio.mean * 100).toFixed(1)}%, trend=${stats.stats.gasUsedRatio.trend}
- Block Interval: mean=${stats.stats.blockInterval.mean}s, trend=${stats.stats.blockInterval.trend}

RECENT METRICS (Last 15 data points):
${JSON.stringify(metricsTable, null, 2)}

Based on this data, predict the optimal vCPU for the next 5 minutes.`;
}

/**
 * Parse AI response and extract prediction
 */
function parseAIResponse(content: string): PredictionResult | null {
  try {
    // Clean markdown formatting if present
    const jsonStr = content
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (
      typeof parsed.predictedVcpu !== 'number' ||
      ![1, 2, 4].includes(parsed.predictedVcpu) ||
      typeof parsed.confidence !== 'number' ||
      parsed.confidence < 0 ||
      parsed.confidence > 1
    ) {
      console.error('Invalid AI response structure:', parsed);
      return null;
    }

    // Ensure factors array is valid
    const factors: PredictionFactor[] = Array.isArray(parsed.factors)
      ? parsed.factors.map((f: { name?: string; impact?: number; description?: string }) => ({
          name: String(f.name || 'unknown'),
          impact: Number(f.impact) || 0,
          description: String(f.description || ''),
        }))
      : [];

    return {
      predictedVcpu: parsed.predictedVcpu as TargetVcpu,
      confidence: parsed.confidence,
      trend: ['rising', 'falling', 'stable'].includes(parsed.trend) ? parsed.trend : 'stable',
      reasoning: String(parsed.reasoning || 'No reasoning provided'),
      recommendedAction: ['scale_up', 'scale_down', 'maintain'].includes(parsed.recommendedAction)
        ? parsed.recommendedAction
        : 'maintain',
      generatedAt: new Date().toISOString(),
      predictionWindow: 'next 5 minutes',
      factors,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to parse AI prediction response:', errorMessage);
    return null;
  }
}

/**
 * Generate fallback prediction when AI is unavailable
 */
function generateFallbackPrediction(currentVcpu: number): PredictionResult {
  const stats = getMetricsStats();

  // Simple rule-based fallback
  let predictedVcpu: TargetVcpu = currentVcpu as TargetVcpu;
  let recommendedAction: 'scale_up' | 'scale_down' | 'maintain' = 'maintain';
  const factors: PredictionFactor[] = [];

  if (stats.stats.cpu.trend === 'rising' && stats.stats.cpu.mean > 50) {
    predictedVcpu = Math.min(4, currentVcpu + 1) as TargetVcpu;
    recommendedAction = 'scale_up';
    factors.push({
      name: 'cpuTrend',
      impact: 0.7,
      description: 'CPU trend is rising with high mean usage',
    });
  } else if (stats.stats.cpu.trend === 'falling' && stats.stats.cpu.mean < 30) {
    predictedVcpu = Math.max(1, currentVcpu - 1) as TargetVcpu;
    recommendedAction = 'scale_down';
    factors.push({
      name: 'cpuTrend',
      impact: -0.5,
      description: 'CPU trend is falling with low mean usage',
    });
  }

  // Ensure valid TargetVcpu
  if (![1, 2, 4].includes(predictedVcpu)) {
    predictedVcpu = 2;
  }

  return {
    predictedVcpu,
    confidence: 0.5, // Low confidence for fallback
    trend: stats.stats.cpu.trend,
    reasoning: 'Fallback prediction based on simple CPU trend analysis (AI unavailable)',
    recommendedAction,
    generatedAt: new Date().toISOString(),
    predictionWindow: 'next 5 minutes',
    factors,
  };
}

/**
 * Main prediction function
 * Analyzes time-series metrics and returns AI-powered prediction
 *
 * @param currentVcpu - Current vCPU allocation
 * @param config - Prediction configuration
 * @returns Prediction result or null if rate limited / insufficient data
 */
export async function predictScaling(
  currentVcpu: number,
  config: PredictionConfig = DEFAULT_PREDICTION_CONFIG
): Promise<PredictionResult | null> {
  // Check rate limiting
  const now = Date.now();
  if (now - lastPredictionTime < config.predictionCooldownSeconds * 1000) {
    // Return cached prediction if within cooldown
    return lastPrediction;
  }

  // Check minimum data points
  const dataPointCount = getMetricsCount();
  if (dataPointCount < config.minDataPoints) {
    console.log(`Insufficient data for prediction: ${dataPointCount}/${config.minDataPoints} points`);
    return null;
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(currentVcpu);

  try {
    console.log(`[Predictive Scaler] Requesting prediction from AI Gateway...`);

    const response = await fetch(`${AI_GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
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
      lastPredictionTime = now;
      lastPrediction = prediction;
      return prediction;
    }

    // Fall back to rule-based prediction
    console.warn('AI returned invalid response, using fallback prediction');
    const fallback = generateFallbackPrediction(currentVcpu);
    lastPredictionTime = now;
    lastPrediction = fallback;
    return fallback;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Prediction AI Gateway Error:', errorMessage);

    // Fall back to rule-based prediction
    const fallback = generateFallbackPrediction(currentVcpu);
    lastPredictionTime = now;
    lastPrediction = fallback;
    return fallback;
  }
}

/**
 * Get the last prediction without making a new request
 * Useful for displaying in UI
 */
export function getLastPrediction(): PredictionResult | null {
  return lastPrediction;
}

/**
 * Check if a new prediction can be made (not rate limited)
 */
export function canMakePrediction(config: PredictionConfig = DEFAULT_PREDICTION_CONFIG): boolean {
  const now = Date.now();
  return now - lastPredictionTime >= config.predictionCooldownSeconds * 1000;
}

/**
 * Get time until next prediction is allowed (in seconds)
 */
export function getNextPredictionIn(config: PredictionConfig = DEFAULT_PREDICTION_CONFIG): number {
  const now = Date.now();
  const elapsed = (now - lastPredictionTime) / 1000;
  return Math.max(0, config.predictionCooldownSeconds - elapsed);
}

/**
 * Reset prediction state (for testing)
 */
export function resetPredictionState(): void {
  lastPredictionTime = 0;
  lastPrediction = null;
}
```

#### 함수 시그니처 요약

| 함수 | 입력 | 출력 | 설명 |
|------|------|------|------|
| `predictScaling(currentVcpu, config?)` | `number`, `PredictionConfig?` | `Promise<PredictionResult \| null>` | AI 예측 실행 (5분 쿨다운) |
| `getLastPrediction()` | - | `PredictionResult \| null` | 마지막 예측 결과 반환 |
| `canMakePrediction(config?)` | `PredictionConfig?` | `boolean` | 예측 가능 여부 (rate limit 체크) |
| `getNextPredictionIn(config?)` | `PredictionConfig?` | `number` | 다음 예측까지 남은 시간 (초) |
| `resetPredictionState()` | - | `void` | 테스트용 상태 초기화 |

---

### 3.3 `src/lib/prediction-tracker.ts`

예측의 정확도를 추적하여 시스템의 신뢰성을 모니터링하는 모듈이다.

#### 전체 구현 코드

```typescript
/**
 * Prediction Tracker Module
 * Tracks prediction accuracy by comparing predictions with actual outcomes
 */

import { PredictionResult, PredictionRecord } from '@/types/prediction';
import { TargetVcpu } from '@/types/scaling';

/** Maximum number of prediction records to keep */
const MAX_RECORDS = 100;

/** In-memory storage for prediction records */
let predictionRecords: PredictionRecord[] = [];

/** Counter for generating unique IDs */
let idCounter = 0;

/**
 * Generate a unique ID for a prediction record
 */
function generateId(): string {
  idCounter += 1;
  return `pred_${Date.now()}_${idCounter}`;
}

/**
 * Record a new prediction for later verification
 *
 * @param prediction - The prediction result to record
 * @returns The ID of the recorded prediction
 */
export function recordPrediction(prediction: PredictionResult): string {
  const id = generateId();

  const record: PredictionRecord = {
    id,
    prediction,
    actualVcpu: undefined,
    wasAccurate: undefined,
    verifiedAt: undefined,
  };

  predictionRecords.push(record);

  // Evict oldest records if over capacity
  if (predictionRecords.length > MAX_RECORDS) {
    predictionRecords = predictionRecords.slice(-MAX_RECORDS);
  }

  return id;
}

/**
 * Record the actual outcome for a prediction
 *
 * @param id - The prediction ID to update
 * @param actualVcpu - The actual vCPU that was needed
 * @returns Whether the record was found and updated
 */
export function recordActual(id: string, actualVcpu: TargetVcpu): boolean {
  const record = predictionRecords.find(r => r.id === id);

  if (!record) {
    console.warn(`Prediction record not found: ${id}`);
    return false;
  }

  record.actualVcpu = actualVcpu;
  record.verifiedAt = new Date().toISOString();

  // A prediction is "accurate" if within 1 vCPU of actual
  // e.g., predicted 2, actual 2 or 1 or 4 with small tolerance
  const diff = Math.abs(record.prediction.predictedVcpu - actualVcpu);
  record.wasAccurate = diff <= 1;

  return true;
}

/**
 * Record actual outcome for the most recent unverified prediction
 * Convenience method when we don't have the specific prediction ID
 *
 * @param actualVcpu - The actual vCPU that was needed
 * @returns Whether a record was found and updated
 */
export function recordActualForRecent(actualVcpu: TargetVcpu): boolean {
  // Find the most recent unverified prediction
  const record = [...predictionRecords]
    .reverse()
    .find(r => r.actualVcpu === undefined);

  if (!record) {
    return false;
  }

  return recordActual(record.id, actualVcpu);
}

/**
 * Calculate prediction accuracy statistics
 *
 * @returns Accuracy statistics
 */
export function getAccuracy(): {
  totalPredictions: number;
  verifiedPredictions: number;
  accuratePredictions: number;
  accuracyRate: number;
  recentAccuracy: number;
} {
  const verified = predictionRecords.filter(r => r.wasAccurate !== undefined);
  const accurate = verified.filter(r => r.wasAccurate === true);

  // Recent accuracy (last 20 verified predictions)
  const recentVerified = verified.slice(-20);
  const recentAccurate = recentVerified.filter(r => r.wasAccurate === true);

  return {
    totalPredictions: predictionRecords.length,
    verifiedPredictions: verified.length,
    accuratePredictions: accurate.length,
    accuracyRate: verified.length > 0 ? accurate.length / verified.length : 0,
    recentAccuracy: recentVerified.length > 0 ? recentAccurate.length / recentVerified.length : 0,
  };
}

/**
 * Get all prediction records
 *
 * @param limit - Maximum number of records to return
 * @returns Array of prediction records, newest first
 */
export function getPredictionRecords(limit: number = 20): PredictionRecord[] {
  return [...predictionRecords].reverse().slice(0, limit);
}

/**
 * Get unverified predictions (predictions awaiting actual outcomes)
 *
 * @returns Array of unverified prediction records
 */
export function getUnverifiedPredictions(): PredictionRecord[] {
  return predictionRecords.filter(r => r.actualVcpu === undefined);
}

/**
 * Clear all prediction records (for testing)
 */
export function clearPredictionRecords(): void {
  predictionRecords = [];
  idCounter = 0;
}
```

#### 함수 시그니처 요약

| 함수 | 입력 | 출력 | 설명 |
|------|------|------|------|
| `recordPrediction(prediction)` | `PredictionResult` | `string` | 예측 기록, ID 반환 |
| `recordActual(id, actualVcpu)` | `string`, `TargetVcpu` | `boolean` | 실제 결과 기록 |
| `recordActualForRecent(actualVcpu)` | `TargetVcpu` | `boolean` | 최근 미검증 예측에 결과 기록 |
| `getAccuracy()` | - | `AccuracyStats` | 정확도 통계 반환 |
| `getPredictionRecords(limit?)` | `number?` | `PredictionRecord[]` | 예측 기록 조회 |
| `getUnverifiedPredictions()` | - | `PredictionRecord[]` | 미검증 예측 목록 |
| `clearPredictionRecords()` | - | `void` | 테스트용 초기화 |

---

## 4. 기존 파일 수정 (Existing File Modifications)

### 4.1 `src/app/api/metrics/route.ts` 수정

#### 4.1.1 Import 추가

**파일 상단 (기존 import 다음에 추가)**

```typescript
// 기존 코드 (lines 1-11)
import { createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { NextResponse } from 'next/server';

// Disable Next.js caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ====== 여기에 추가 ======
import { pushMetric } from '@/lib/metrics-store';
import { MetricDataPoint } from '@/types/prediction';
// ========================
```

#### 4.1.2 블록 간격 추적 변수 추가

**`k8sTokenCache` 선언 이후에 추가 (line 18 근처)**

```typescript
// 기존 코드 (lines 17-18)
// Global Cache for K8s Token to avoid expensive executables per request
let k8sTokenCache: { token: string; expiresAt: number } | null = null;

// ====== 여기에 추가 ======
// Block interval tracking for metrics store
let lastL2BlockHeight: bigint | null = null;
let lastL2BlockTime: number | null = null;
// ========================
```

#### 4.1.3 메트릭 수집 후 MetricsStore에 저장

**GET 핸들러 내부, response 생성 직전에 추가**

위치: `const response = NextResponse.json({...})` 직전 (line 422 근처)

```typescript
        // 기존 코드 (lines 400-420)
        const FARGATE_VCPU_HOUR = 0.04656;
        const FARGATE_MEM_GB_HOUR = 0.00511;
        const HOURS_PER_MONTH = 730;

        // Calculate monthly op-geth cost based on current vCPU
        const memoryGiB = currentVcpu * 2;
        const opGethMonthlyCost = (currentVcpu * FARGATE_VCPU_HOUR + memoryGiB * FARGATE_MEM_GB_HOUR) * HOURS_PER_MONTH;

        // Cost for fixed 4 vCPU (Baseline)
        const fixedCost = (4 * FARGATE_VCPU_HOUR + 8 * FARGATE_MEM_GB_HOUR) * HOURS_PER_MONTH; // $165.67

        // Current savings vs 4 vCPU
        const currentSaving = fixedCost - opGethMonthlyCost;

        // Dynamic Scaler estimated average cost (70% 1vCPU, 20% 2vCPU, 10% 4vCPU)
        const avgVcpu = 0.7 * 1 + 0.2 * 2 + 0.1 * 4; // 1.5 vCPU Average
        const avgMemory = avgVcpu * 2;
        const dynamicMonthlyCost = (avgVcpu * FARGATE_VCPU_HOUR + avgMemory * FARGATE_MEM_GB_HOUR) * HOURS_PER_MONTH;
        const maxMonthlySaving = fixedCost - dynamicMonthlyCost; // ~$114

        const currentHourlyCost = opGethMonthlyCost / HOURS_PER_MONTH;

        // ====== 여기에 추가 ======
        // Calculate block interval and push to metrics store
        const now = Date.now();
        let blockInterval = 2.0; // Default block interval (L2 typical)

        if (lastL2BlockHeight !== null && lastL2BlockTime !== null) {
          if (blockNumber > lastL2BlockHeight) {
            // New block detected, calculate interval
            const timeDiff = (now - lastL2BlockTime) / 1000; // Convert to seconds
            const blockDiff = Number(blockNumber - lastL2BlockHeight);
            blockInterval = timeDiff / blockDiff;
          }
        }

        // Update tracking variables
        lastL2BlockHeight = blockNumber;
        lastL2BlockTime = now;

        // Push data point to metrics store (only for real data, not stress test)
        if (!isStressTest) {
          const dataPoint: MetricDataPoint = {
            timestamp: new Date().toISOString(),
            cpuUsage: effectiveCpu,
            txPoolPending: effectiveTx,
            gasUsedRatio: gasUsed / gasLimit,
            blockHeight: Number(blockNumber),
            blockInterval,
            currentVcpu,
          };
          pushMetric(dataPoint);
        }
        // ========================

        const response = NextResponse.json({
```

---

### 4.2 `src/app/api/scaler/route.ts` 수정

#### 4.2.1 Import 추가

**파일 상단 import 섹션에 추가**

```typescript
// 기존 코드 (lines 1-29)
/**
 * Scaler API Endpoint
 * GET: Get current scaling state
 * POST: Trigger manual scaling or execute auto-scaling
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  makeScalingDecision,
  mapAIResultToSeverity,
} from '@/lib/scaling-decision';
import {
  scaleOpGeth,
  getScalingState,
  addScalingHistory,
  isAutoScalingEnabled,
  setAutoScalingEnabled,
  getCurrentVcpu,
  updateScalingState,
  isSimulationMode,
  setSimulationMode,
} from '@/lib/k8s-scaler';
import {
  ScalerRequest,
  ScalerResponse,
  ScalingMetrics,
  TargetVcpu,
  DEFAULT_SCALING_CONFIG,
} from '@/types/scaling';

// ====== 여기에 추가 ======
import { predictScaling, getLastPrediction, getNextPredictionIn } from '@/lib/predictive-scaler';
import { getMetricsCount } from '@/lib/metrics-store';
import { PredictionResult, DEFAULT_PREDICTION_CONFIG } from '@/types/prediction';
// ========================
```

#### 4.2.2 GET 핸들러 수정 (예측 데이터 추가)

**GET 함수 전체 교체**

```typescript
/**
 * GET: Get current scaling state with prediction
 */
export async function GET(_request: NextRequest) {
  try {
    const state = getScalingState();
    const currentVcpu = await getCurrentVcpu();

    // Sync with actual K8s state
    if (currentVcpu !== state.currentVcpu) {
      updateScalingState({
        currentVcpu,
        currentMemoryGiB: (currentVcpu * 2) as 2 | 4 | 8,
      });
    }

    // Get or generate prediction
    let prediction: PredictionResult | null = getLastPrediction();
    const metricsCount = getMetricsCount();

    // Try to generate new prediction if we have enough data
    if (metricsCount >= DEFAULT_PREDICTION_CONFIG.minDataPoints) {
      const newPrediction = await predictScaling(currentVcpu);
      if (newPrediction) {
        prediction = newPrediction;
      }
    }

    // Build prediction info for response
    const predictionInfo = prediction
      ? {
          predictedVcpu: prediction.predictedVcpu,
          confidence: prediction.confidence,
          trend: prediction.trend,
          reasoning: prediction.reasoning,
          recommendedAction: prediction.recommendedAction,
          generatedAt: prediction.generatedAt,
          predictionWindow: prediction.predictionWindow,
          factors: prediction.factors,
        }
      : null;

    return NextResponse.json({
      ...getScalingState(),
      simulationMode: isSimulationMode(),
      timestamp: new Date().toISOString(),
      // New prediction fields
      prediction: predictionInfo,
      predictionMeta: {
        metricsCount,
        minRequired: DEFAULT_PREDICTION_CONFIG.minDataPoints,
        nextPredictionIn: getNextPredictionIn(),
        isReady: metricsCount >= DEFAULT_PREDICTION_CONFIG.minDataPoints,
      },
    });
  } catch (error) {
    console.error('GET /api/scaler error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to get scaling state', message },
      { status: 500 }
    );
  }
}
```

#### 4.2.3 POST 핸들러 수정 (예측 기반 스케일링 지원)

**POST 함수의 auto-scaling 섹션 수정**

기존 auto-scaling 섹션 (line 146-175 근처)을 다음으로 교체:

```typescript
    } else {
      // Auto-scaling (with optional predictive mode)
      if (!isAutoScalingEnabled()) {
        return NextResponse.json(
          { error: 'Auto-scaling is disabled', autoScalingEnabled: false },
          { status: 400 }
        );
      }

      // Collect metrics
      const metrics = await fetchCurrentMetrics(baseUrl);
      if (!metrics) {
        return NextResponse.json(
          { error: 'Failed to fetch metrics' },
          { status: 500 }
        );
      }

      // AI Analysis (Optional - Continue even if failed)
      const aiAnalysis = await fetchAIAnalysis(baseUrl);
      const aiSeverity = mapAIResultToSeverity(aiAnalysis);

      // Scaling Decision
      const scalingMetrics: ScalingMetrics = {
        ...metrics,
        aiSeverity,
      };

      // Get reactive decision
      const reactiveDecision = makeScalingDecision(scalingMetrics);

      // Try predictive scaling for preemptive action
      const currentVcpu = await getCurrentVcpu();
      const prediction = await predictScaling(currentVcpu);

      // Use predictive decision if confidence is high enough and it suggests scaling up
      if (
        prediction &&
        prediction.confidence >= DEFAULT_PREDICTION_CONFIG.confidenceThreshold &&
        prediction.recommendedAction === 'scale_up' &&
        prediction.predictedVcpu > reactiveDecision.targetVcpu
      ) {
        // Preemptive scaling based on prediction
        decision = {
          targetVcpu: prediction.predictedVcpu,
          targetMemoryGiB: (prediction.predictedVcpu * 2) as 2 | 4 | 8,
          reason: `[Predictive] ${prediction.reasoning} (Confidence: ${(prediction.confidence * 100).toFixed(0)}%)`,
          confidence: prediction.confidence,
          score: reactiveDecision.score,
          breakdown: reactiveDecision.breakdown,
        };
        triggeredBy = 'auto';
        console.log(`[Predictive Scaler] Preemptive scale-up: ${currentVcpu} -> ${prediction.predictedVcpu} vCPU`);
      } else {
        // Use reactive decision
        decision = reactiveDecision;
      }
    }
```

---

### 4.3 `src/app/page.tsx` 수정

#### 4.3.1 예측 관련 인터페이스 추가

**MetricData 인터페이스 다음에 추가 (line 38 근처)**

```typescript
// 기존 코드 (lines 14-38)
interface MetricData {
  timestamp: string;
  metrics: {
    l1BlockHeight: number;
    blockHeight: number;
    txPoolCount: number;
    cpuUsage: number;
    memoryUsage: number;
    gethVcpu: number;
    gethMemGiB: number;
    syncLag: number;
  };
  components?: ComponentData[];
  cost: {
    hourlyRate: number;
    opGethMonthlyCost?: number;
    currentSaving?: number;
    dynamicMonthlyCost?: number;
    maxMonthlySaving?: number;
    fixedCost?: number;
    monthlyEstimated: number;
    monthlySaving: number;
    isPeakMode: boolean;
  };
}

// ====== 여기에 추가 ======
interface PredictionFactor {
  name: string;
  impact: number;
  description: string;
}

interface PredictionInfo {
  predictedVcpu: 1 | 2 | 4;
  confidence: number;
  trend: 'rising' | 'falling' | 'stable';
  reasoning: string;
  recommendedAction: 'scale_up' | 'scale_down' | 'maintain';
  generatedAt: string;
  predictionWindow: string;
  factors: PredictionFactor[];
}

interface PredictionMeta {
  metricsCount: number;
  minRequired: number;
  nextPredictionIn: number;
  isReady: boolean;
}

interface ScalerState {
  currentVcpu: number;
  currentMemoryGiB: number;
  cooldownRemaining: number;
  autoScalingEnabled: boolean;
  simulationMode: boolean;
  prediction: PredictionInfo | null;
  predictionMeta: PredictionMeta;
}
// ========================
```

#### 4.3.2 예측 상태 변수 추가

**Dashboard 컴포넌트 내부, 기존 state 선언 다음에 추가**

```typescript
// 기존 코드 (lines 56-63)
export default function Dashboard() {
  // State
  const [dataHistory, setDataHistory] = useState<{ name: string; cpu: number; gethVcpu: number; gethMemGiB: number; saving: number; cost: number }[]>([]);
  const [current, setCurrent] = useState<MetricData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stressMode, setStressMode] = useState(false);
  const [logInsight, setLogInsight] = useState<{ summary: string; severity: string; timestamp: string; action_item?: string } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // ====== 여기에 추가 ======
  const [prediction, setPrediction] = useState<PredictionInfo | null>(null);
  const [predictionMeta, setPredictionMeta] = useState<PredictionMeta | null>(null);
  // ========================
```

#### 4.3.3 예측 데이터 폴링 추가

**fetchData 함수 내부, setCurrent(data) 다음에 추가**

```typescript
        // 기존 코드 (lines 117-128)
        setCurrent(data);

        const point = {
          name: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          cpu: data.metrics.cpuUsage,
          gethVcpu: data.metrics.gethVcpu,
          gethMemGiB: data.metrics.gethMemGiB,
          saving: data.cost.monthlySaving,
          cost: data.cost.monthlyEstimated,
        };
        setDataHistory(prev => [...prev.slice(-20), point]);

        // ====== 여기에 추가 ======
        // Fetch scaler state with prediction (every 10 seconds to avoid overload)
        if (timestamp % 10000 < 1000) {
          try {
            const scalerRes = await fetch('/api/scaler', {
              cache: 'no-store',
              signal: controller.signal,
            });
            if (scalerRes.ok) {
              const scalerData: ScalerState = await scalerRes.json();
              setPrediction(scalerData.prediction);
              setPredictionMeta(scalerData.predictionMeta);
            }
          } catch {
            // Ignore scaler fetch errors
          }
        }
        // ========================

        setIsLoading(false);
```

#### 4.3.4 Scaling Forecast 카드 UI 수정

**Scaling Forecast 카드 전체 교체 (lines 241-261)**

기존 코드:

```typescript
          {/* Scaling Forecast Card */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-4">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-bold text-gray-900">Scaling Forecast</h3>
              </div>
              <span className="bg-blue-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase">Live</span>
            </div>

            {/* AI Insight Box */}
            <div className="mt-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex items-start gap-2">
                <Zap size={14} className="text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-gray-600 leading-relaxed">
                  {current?.cost.isPeakMode
                    ? `Scaling up to handle traffic spike, current cost: $${current?.cost.opGethMonthlyCost?.toFixed(0) || '166'}/mo.`
                    : `Running at ${current?.metrics.gethVcpu || 1} vCPU, estimated savings: `}
                  {!current?.cost.isPeakMode && <span className="text-green-600 font-bold">${current?.cost.monthlySaving?.toFixed(0) || '124'}/mo</span>}
                </p>
              </div>
            </div>
          </div>
```

교체 코드:

```typescript
          {/* Scaling Forecast Card */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-4">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-bold text-gray-900">Scaling Forecast</h3>
                {prediction && (
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    AI Confidence: {(prediction.confidence * 100).toFixed(0)}%
                  </p>
                )}
              </div>
              <span className={`text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase ${
                prediction?.recommendedAction === 'scale_up'
                  ? 'bg-orange-500'
                  : prediction?.recommendedAction === 'scale_down'
                  ? 'bg-green-500'
                  : 'bg-blue-500'
              }`}>
                {prediction?.recommendedAction === 'scale_up' ? 'Scale Up' :
                 prediction?.recommendedAction === 'scale_down' ? 'Scale Down' : 'Stable'}
              </span>
            </div>

            {/* Prediction Visualization */}
            {prediction && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">Current</span>
                  <span className="text-xs text-gray-500">Predicted ({prediction.predictionWindow})</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                    <span className="text-lg font-bold text-gray-900">{current?.metrics.gethVcpu || 1} vCPU</span>
                  </div>
                  <ArrowUpRight size={20} className={`shrink-0 ${
                    prediction.trend === 'rising' ? 'text-orange-500' :
                    prediction.trend === 'falling' ? 'text-green-500 rotate-180' :
                    'text-gray-400 rotate-45'
                  }`} />
                  <div className={`flex-1 h-8 rounded-lg flex items-center justify-center ${
                    prediction.predictedVcpu > (current?.metrics.gethVcpu || 1)
                      ? 'bg-orange-100 border border-orange-200'
                      : prediction.predictedVcpu < (current?.metrics.gethVcpu || 1)
                      ? 'bg-green-100 border border-green-200'
                      : 'bg-blue-100 border border-blue-200'
                  }`}>
                    <span className={`text-lg font-bold ${
                      prediction.predictedVcpu > (current?.metrics.gethVcpu || 1)
                        ? 'text-orange-600'
                        : prediction.predictedVcpu < (current?.metrics.gethVcpu || 1)
                        ? 'text-green-600'
                        : 'text-blue-600'
                    }`}>{prediction.predictedVcpu} vCPU</span>
                  </div>
                </div>
              </div>
            )}

            {/* Data Collection Progress (when not enough data) */}
            {predictionMeta && !predictionMeta.isReady && (
              <div className="mb-4 p-3 bg-yellow-50 rounded-xl border border-yellow-100">
                <div className="flex items-center gap-2 mb-2">
                  <Activity size={14} className="text-yellow-600" />
                  <span className="text-xs font-medium text-yellow-800">Collecting Data...</span>
                </div>
                <div className="w-full h-2 bg-yellow-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-500 rounded-full transition-all duration-500"
                    style={{ width: `${(predictionMeta.metricsCount / predictionMeta.minRequired) * 100}%` }}
                  />
                </div>
                <p className="text-[10px] text-yellow-600 mt-1">
                  {predictionMeta.metricsCount}/{predictionMeta.minRequired} data points
                </p>
              </div>
            )}

            {/* AI Insight Box */}
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex items-start gap-2">
                <Zap size={14} className="text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-gray-600 leading-relaxed">
                  {prediction ? (
                    prediction.reasoning
                  ) : current?.cost.isPeakMode ? (
                    `Scaling up to handle traffic spike, current cost: $${current?.cost.opGethMonthlyCost?.toFixed(0) || '166'}/mo.`
                  ) : (
                    <>Running at {current?.metrics.gethVcpu || 1} vCPU, estimated savings: <span className="text-green-600 font-bold">${current?.cost.monthlySaving?.toFixed(0) || '124'}/mo</span></>
                  )}
                </p>
              </div>
            </div>

            {/* Prediction Factors */}
            {prediction && prediction.factors.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-[10px] text-gray-400 font-semibold uppercase mb-2">Key Factors</p>
                <div className="space-y-1">
                  {prediction.factors.slice(0, 3).map((factor, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        factor.impact > 0.3 ? 'bg-orange-500' :
                        factor.impact < -0.3 ? 'bg-green-500' :
                        'bg-gray-400'
                      }`} />
                      <span className="text-gray-600">{factor.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
```

#### 4.3.5 예측 차트 추가 (선택적)

**System Health 섹션 다음, Total Saved Card 이전에 추가** (line 302 근처)

```typescript
          {/* System Health */}
          <div className="mb-4">
            {/* ... existing System Health code ... */}
          </div>

          {/* ====== 여기에 추가 ====== */}
          {/* Prediction Trend Chart */}
          {dataHistory.length > 5 && (
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-gray-900 text-sm">Resource Trend</h4>
                {prediction && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    prediction.trend === 'rising' ? 'bg-orange-100 text-orange-600' :
                    prediction.trend === 'falling' ? 'bg-green-100 text-green-600' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {prediction.trend.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dataHistory}>
                    <defs>
                      <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fill: '#9CA3AF' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#9CA3AF' }}
                      axisLine={false}
                      tickLine={false}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1F2937',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#F3F4F6'
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="cpu"
                      stroke="#3B82F6"
                      fill="url(#cpuGradient)"
                      strokeWidth={2}
                      name="CPU %"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {prediction && (
                <div className="flex items-center justify-center gap-2 mt-2 text-[10px] text-gray-400">
                  <div className="w-2 h-2 bg-blue-500 rounded-full" />
                  <span>Current Load</span>
                  <div className="w-2 h-2 bg-orange-500 rounded-full ml-3" />
                  <span>Predicted: {prediction.predictedVcpu} vCPU</span>
                </div>
              )}
            </div>
          )}
          {/* ======================== */}

          {/* Total Saved Card (Dark) */}
          <div className="mt-auto bg-[#1A1D21] rounded-2xl p-5 text-white">
```

---

## 5. API 명세 (API Specification)

### 5.1 GET /api/scaler (확장)

#### Request

```
GET /api/scaler
```

#### Response (확장됨)

```typescript
interface ScalerGetResponse {
  // 기존 필드
  currentVcpu: number;
  currentMemoryGiB: number;
  lastScalingTime: string | null;
  lastDecision: ScalingDecision | null;
  cooldownRemaining: number;
  autoScalingEnabled: boolean;
  simulationMode: boolean;
  timestamp: string;

  // 신규 필드: 예측 정보
  prediction: {
    predictedVcpu: 1 | 2 | 4;
    confidence: number;
    trend: 'rising' | 'falling' | 'stable';
    reasoning: string;
    recommendedAction: 'scale_up' | 'scale_down' | 'maintain';
    generatedAt: string;
    predictionWindow: string;
    factors: {
      name: string;
      impact: number;
      description: string;
    }[];
  } | null;

  // 신규 필드: 예측 메타데이터
  predictionMeta: {
    metricsCount: number;
    minRequired: number;
    nextPredictionIn: number;
    isReady: boolean;
  };
}
```

#### 응답 예시

```json
{
  "currentVcpu": 1,
  "currentMemoryGiB": 2,
  "lastScalingTime": "2026-02-06T10:30:00.000Z",
  "lastDecision": null,
  "cooldownRemaining": 0,
  "autoScalingEnabled": true,
  "simulationMode": true,
  "timestamp": "2026-02-06T10:45:00.000Z",
  "prediction": {
    "predictedVcpu": 2,
    "confidence": 0.85,
    "trend": "rising",
    "reasoning": "CPU usage showing upward trend (slope: 1.2), TxPool increasing. Recommend scaling to 2 vCPU within 5 minutes to handle anticipated load.",
    "recommendedAction": "scale_up",
    "generatedAt": "2026-02-06T10:44:55.000Z",
    "predictionWindow": "next 5 minutes",
    "factors": [
      {
        "name": "cpuTrend",
        "impact": 0.7,
        "description": "CPU usage rising steadily over last 15 minutes"
      },
      {
        "name": "txPoolGrowth",
        "impact": 0.5,
        "description": "Pending transactions increasing"
      }
    ]
  },
  "predictionMeta": {
    "metricsCount": 45,
    "minRequired": 10,
    "nextPredictionIn": 120,
    "isReady": true
  }
}
```

---

## 6. AI 프롬프트 전문 (Complete AI Prompts)

### 6.1 System Prompt

```
You are an expert Site Reliability Engineer specializing in Kubernetes auto-scaling for Optimism L2 blockchain nodes.

Your task is to analyze time-series metrics and predict the optimal vCPU allocation for the next 5 minutes.

CONTEXT:
- Target: op-geth (Optimism Execution Client) running on AWS Fargate
- vCPU options: 1, 2, or 4 vCPU (memory is always vCPU × 2 GiB)
- Current scaling is reactive; you must predict AHEAD of load spikes
- Cost optimization is important: avoid over-provisioning

ANALYSIS FACTORS:
1. CPU Usage Trend: Rising trend suggests upcoming load
2. TxPool Pending: High pending txs indicate batch processing ahead
3. Gas Usage Ratio: Reflects EVM computation intensity
4. Block Interval: Shorter intervals mean faster chain, higher resource needs
5. Time Patterns: Consider time-of-day patterns if visible in data

DECISION RULES:
- Stable low load (CPU < 30%, TxPool < 50): Recommend 1 vCPU
- Moderate or rising load: Recommend 2 vCPU
- High load or spike incoming: Recommend 4 vCPU
- When in doubt, prioritize availability over cost

OUTPUT FORMAT:
Return ONLY a valid JSON object (no markdown, no explanation outside JSON):
{
  "predictedVcpu": 1 | 2 | 4,
  "confidence": 0.0 to 1.0,
  "trend": "rising" | "falling" | "stable",
  "reasoning": "Brief explanation of prediction logic",
  "recommendedAction": "scale_up" | "scale_down" | "maintain",
  "factors": [
    { "name": "factorName", "impact": -1.0 to 1.0, "description": "explanation" }
  ]
}
```

### 6.2 User Prompt Template

```
CURRENT STATE:
- Current vCPU: ${currentVcpu}
- Data points available: ${stats.count}
- Time range: ${oldestTime} to ${newestTime}

STATISTICAL SUMMARY (Last ${stats.count} minutes):
- CPU: mean=${stats.stats.cpu.mean}%, stdDev=${stats.stats.cpu.stdDev}, trend=${stats.stats.cpu.trend}, slope=${stats.stats.cpu.slope}
- TxPool: mean=${stats.stats.txPool.mean}, stdDev=${stats.stats.txPool.stdDev}, trend=${stats.stats.txPool.trend}, slope=${stats.stats.txPool.slope}
- Gas Ratio: mean=${gasRatioPercent}%, trend=${stats.stats.gasUsedRatio.trend}
- Block Interval: mean=${stats.stats.blockInterval.mean}s, trend=${stats.stats.blockInterval.trend}

RECENT METRICS (Last 15 data points):
${JSON.stringify(metricsTable, null, 2)}

Based on this data, predict the optimal vCPU for the next 5 minutes.
```

### 6.3 Expected Response Format

```json
{
  "predictedVcpu": 2,
  "confidence": 0.85,
  "trend": "rising",
  "reasoning": "CPU usage showing consistent upward trend with slope of 1.2. Combined with increasing TxPool (mean: 45, rising), anticipate need for additional resources within 5 minutes.",
  "recommendedAction": "scale_up",
  "factors": [
    {
      "name": "cpuTrend",
      "impact": 0.7,
      "description": "CPU usage rising steadily from 25% to 45% over 15 minutes"
    },
    {
      "name": "txPoolGrowth",
      "impact": 0.4,
      "description": "Pending transactions increased 80% in last 10 minutes"
    },
    {
      "name": "gasUsage",
      "impact": 0.2,
      "description": "Gas usage stable at 35%, indicating moderate EVM load"
    }
  ]
}
```

---

## 7. 환경 변수 (Environment Variables)

이 제안서는 **기존 환경 변수만 사용**하므로 추가 환경 변수가 필요하지 않다.

**사용되는 기존 환경 변수:**

| 변수 | 용도 | 필수 |
|------|------|------|
| `AI_GATEWAY_URL` | AI Gateway 엔드포인트 | Yes |
| `ANTHROPIC_API_KEY` | AI API 인증 키 | Yes |

---

## 8. 테스트 검증 (Verification)

### 8.1 API 테스트 (curl)

#### MetricsStore 데이터 수집 확인

```bash
# 메트릭 수집 시작 (1분마다 자동 수집됨, 개발 시 수동 호출 가능)
for i in {1..15}; do
  curl -s http://localhost:3002/api/metrics | jq '.metrics.cpuUsage'
  sleep 5
done
```

#### 예측 API 테스트

```bash
# 예측 데이터 포함 스케일러 상태 조회
curl -s http://localhost:3002/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  prediction: .prediction,
  predictionMeta: .predictionMeta
}'
```

#### 예상 출력 (데이터 충분 시)

```json
{
  "currentVcpu": 1,
  "prediction": {
    "predictedVcpu": 2,
    "confidence": 0.78,
    "trend": "rising",
    "reasoning": "CPU trend rising with slope 0.8...",
    "recommendedAction": "scale_up"
  },
  "predictionMeta": {
    "metricsCount": 15,
    "minRequired": 10,
    "nextPredictionIn": 240,
    "isReady": true
  }
}
```

#### 예상 출력 (데이터 부족 시)

```json
{
  "currentVcpu": 1,
  "prediction": null,
  "predictionMeta": {
    "metricsCount": 5,
    "minRequired": 10,
    "nextPredictionIn": 0,
    "isReady": false
  }
}
```

### 8.2 UI 검증 시나리오

#### 시나리오 1: 데이터 수집 중

1. 애플리케이션 시작 직후 대시보드 접속
2. "Scaling Forecast" 카드에 "Collecting Data..." 표시 확인
3. 프로그레스 바가 `metricsCount/minRequired` 비율로 채워짐
4. 10분 후 예측 데이터 표시 시작

#### 시나리오 2: 정상 예측 표시

1. 충분한 데이터 수집 후 (10+ 데이터 포인트)
2. "Scaling Forecast" 카드에 예측 vCPU 표시
3. Current → Predicted 시각화 확인
4. Trend 방향 화살표 아이콘 동작 확인
5. Key Factors 목록 표시 확인

#### 시나리오 3: 스케일업 예측 시

1. Stress Mode 활성화
2. CPU 사용량 급증 시뮬레이션
3. 예측이 "scale_up" 권장으로 변경되는지 확인
4. 배지 색상이 주황색으로 변경되는지 확인

### 8.3 Edge Cases

| 케이스 | 예상 동작 |
|--------|----------|
| AI Gateway 연결 실패 | Fallback 예측 사용 (confidence 0.5) |
| 데이터 10개 미만 | prediction: null, isReady: false |
| 5분 쿨다운 내 재요청 | 캐시된 예측 반환 |
| 모든 메트릭 0 | stable 예측, confidence 낮음 |
| AI가 잘못된 JSON 반환 | Fallback 예측 사용 |

---

## 9. 의존 관계 (Dependencies)

### 9.1 공유 모듈

`src/lib/metrics-store.ts`는 다음 제안서들에서 공유 사용될 예정:

| 제안서 | 사용 목적 |
|--------|----------|
| Proposal 2: Anomaly Detection | 이상 징후 패턴 분석 |
| Proposal 3: Resource Analytics | 리소스 사용량 통계 |
| Proposal 4: Cost Optimization | 비용 최적화 분석 |

### 9.2 독립 구현 가능

이 제안서(Proposal 1)는 **다른 제안서에 의존하지 않으며**, 완전히 독립적으로 구현 가능하다.

### 9.3 구현 순서 권장

1. `src/types/prediction.ts` - 타입 정의
2. `src/lib/metrics-store.ts` - 공유 모듈
3. `src/lib/predictive-scaler.ts` - 예측 로직
4. `src/lib/prediction-tracker.ts` - 정확도 추적
5. `src/app/api/metrics/route.ts` 수정
6. `src/app/api/scaler/route.ts` 수정
7. `src/app/page.tsx` 수정

---

## 10. 체크리스트 (Implementation Checklist)

구현 완료 후 다음 항목을 확인:

- [ ] TypeScript strict mode 오류 없음
- [ ] `npm run lint` 통과
- [ ] `npm run build` 성공
- [ ] MetricsStore에 데이터 축적 확인 (console.log로 count 출력)
- [ ] 10개 이상 데이터 포인트 후 예측 생성 확인
- [ ] AI Gateway 호출 성공 (또는 fallback 동작)
- [ ] UI에 예측 정보 정상 표시
- [ ] 5분 쿨다운 동작 확인
- [ ] 에러 발생 시 적절한 fallback 처리

---

## 부록: 파일 구조

```
src/
├── types/
│   ├── scaling.ts          # 기존 (변경 없음)
│   └── prediction.ts       # 신규
├── lib/
│   ├── scaling-decision.ts # 기존 (변경 없음)
│   ├── k8s-scaler.ts       # 기존 (변경 없음)
│   ├── ai-analyzer.ts      # 기존 (변경 없음)
│   ├── metrics-store.ts    # 신규 (공유 모듈)
│   ├── predictive-scaler.ts # 신규
│   └── prediction-tracker.ts # 신규
├── app/
│   ├── api/
│   │   ├── metrics/
│   │   │   └── route.ts    # 수정
│   │   └── scaler/
│   │       └── route.ts    # 수정
│   └── page.tsx            # 수정
```

---

*문서 끝*
