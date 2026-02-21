# Proposal 1: Predictive Scaling

## Document information

| Item | Content |
|------|------|
| version | 1.0.0 |
| Created date | 2026-02-06 |
| target | Claude Opus 4.6 Implementation Agent |
| Dependency | None (can be implemented independently) |

---

## 1. Overview

### 1.1 Feature Summary

Predictive Scaling is a function that uses AI to analyze time series patterns of past metric data to predict **future load** and perform preemptive scaling** before actual load occurs.

### 1.2 Solving Problems

Currently, SentinAI's scaling logic (`src/lib/scaling-decision.ts`) makes decisions based only on **current metrics**. This causes:

Error 500 (Server Error)!!1500.That’s an error.There was an error. Please try again later.That’s all we know.
2. **Cooldown Delay**: No further scaling during 5 minute cooldown.
3. **Not utilizing predictable patterns**: Not learning daily/weekly traffic patterns.

### 1.3 Core Values

- **Proactive scaling**: Reserve resources 5 minutes before load occurs
- **Cost Optimization**: Avoid unnecessary overprovisioning
- **Confidence-based decision making**: Executed only when the confidence of the AI ​​prediction is above the threshold (0.7)

### 1.4 Dependencies

This proposal **can be implemented independently**. However, since the `MetricsStore` module will be shared and used in Proposals 2, 3, and 4 in the future, it needs to be designed with scalability in mind.

---

## 2. Type Definitions

### 2.1 New file: `src/types/prediction.ts`

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

## 3. New file specifications (New Files)

### 3.1 `src/lib/metrics-store.ts` (shared module)

This module implements **Ring Buffer**, which manages time series metric data. For memory efficiency, only a maximum of 60 data points are maintained (1 hour's worth when collected at 1-minute intervals).

#### Full implementation code

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

#### Function signature summary

| function | input | output | Description |
|------|------|------|------|
| `pushMetric(dataPoint)` | `MetricDataPoint` | `void` | Add new data points, remove oldest data if more than 60 |
| `getRecentMetrics(count?)` | `number \| undefined` | `MetricDataPoint[]` | Returns the most recent N data (default: all) |
| `getMetricsStats()` | - | `MetricsStoreStats` | Statistical Summary (Mean, Standard Deviation, Trend) |
| `clearMetrics()` | - | `void` | buffer initialization |
| `getMetricsCount()` | - | `number` | Number of currently stored data points |

---

### 3.2 `src/lib/predictive-scaler.ts`

This is a module that uses AI to analyze time series data and predict the need for future scaling.

#### Full implementation code

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

#### Function signature summary

| function | input | output | Description |
|------|------|------|------|
| `predictScaling(currentVcpu, config?)` | `number`, `PredictionConfig?` | `Promise<PredictionResult\| null>` | AI Predictive Execution (5 minute cooldown) |
| `getLastPrediction()` | - | `PredictionResult\| null` | Return last prediction result |
| `canMakePrediction(config?)` | `PredictionConfig?` | `boolean` | Predictability (check rate limit) |
| `getNextPredictionIn(config?)` | `PredictionConfig?` | `number` | Seconds until next prediction |
| `resetPredictionState()` | - | `void` | Initializing state for testing |

---

### 3.3 `src/lib/prediction-tracker.ts`

This module monitors the reliability of the system by tracking the accuracy of predictions.

#### Full implementation code

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

#### Function signature summary

| function | input | output | Description |
|------|------|------|------|
| `recordPrediction(prediction)` | `PredictionResult` | `string` | prediction history, return id |
| `recordActual(id, actualVcpu)` | `string`, `TargetVcpu` | `boolean` | RECORD OF ACTUAL RESULTS |
| `recordActualForRecent(actualVcpu)` | `TargetVcpu` | `boolean` | Record results in recent untested predictions |
| `getAccuracy()` | - | `AccuracyStats` | return accuracy statistics |
| `getPredictionRecords(limit?)` | `number?` | `PredictionRecord[]` | Forecast History View |
| `getUnverifiedPredictions()` | - | `PredictionRecord[]` | List of unverified predictions |
| `clearPredictionRecords()` | - | `void` | Initialization for testing |

---

## 4. Existing File Modifications

### 4.1 Modify `src/app/api/metrics/route.ts`

#### 4.1.1 Add Import

**Top of file (added after existing import)**

```typescript
// existing code (lines 1-11)
import { createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { NextResponse } from 'next/server';

// Disable Next.js caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ====== Add here ======
import { pushMetric } from '@/lib/metrics-store';
import { MetricDataPoint } from '@/types/prediction';
// ========================
```

#### 4.1.2 Add block interval tracking variable

**Added after declaration of `k8sTokenCache` (near line 18)**

```typescript
// existing code (lines 17-18)
// Global Cache for K8s Token to avoid expensive executables per request
let k8sTokenCache: { token: string; expiresAt: number } | null = null;

// ====== Add here ======
// Block interval tracking for metrics store
let lastL2BlockHeight: bigint | null = null;
let lastL2BlockTime: number | null = null;
// ========================
```

#### 4.1.3 Collect metrics and save them to MetricsStore

**Inside GET handler, added just before creating response**

Location: Just before `const response = NextResponse.json({...})` (near line 422)

```typescript
// existing code (lines 400-420)
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

// ====== Add here ======
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

### 4.2 Modify `src/app/api/scaler/route.ts`

#### 4.2.1 Add Import

**Add to the import section at the top of the file**

```typescript
// existing code (lines 1-29)
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

// ====== Add here ======
import { predictScaling, getLastPrediction, getNextPredictionIn } from '@/lib/predictive-scaler';
import { getMetricsCount } from '@/lib/metrics-store';
import { PredictionResult, DEFAULT_PREDICTION_CONFIG } from '@/types/prediction';
// ========================
```

#### 4.2.2 Modify GET handler (add prediction data)

**Replace entire GET function**

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

#### 4.2.3 Modify POST handler (support prediction-based scaling)

**Modify auto-scaling section of POST function**

Replace the existing auto-scaling section (near lines 146-175) with:

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

### 4.3 Modify `src/app/page.tsx`

#### 4.3.1 Addition of prediction related interface

**Added after the MetricData interface (near line 38)**

```typescript
// existing code (lines 14-38)
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

// ====== Add here ======
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

#### 4.3.2 Add prediction state variable

**Inside Dashboard component, added after existing state declaration**

```typescript
// existing code (lines 56-63)
export default function Dashboard() {
  // State
  const [dataHistory, setDataHistory] = useState<{ name: string; cpu: number; gethVcpu: number; gethMemGiB: number; saving: number; cost: number }[]>([]);
  const [current, setCurrent] = useState<MetricData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stressMode, setStressMode] = useState(false);
  const [logInsight, setLogInsight] = useState<{ summary: string; severity: string; timestamp: string; action_item?: string } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

// ====== Add here ======
  const [prediction, setPrediction] = useState<PredictionInfo | null>(null);
  const [predictionMeta, setPredictionMeta] = useState<PredictionMeta | null>(null);
  // ========================
```

#### 4.3.3 Add forecast data polling

**Inside the fetchData function, added after setCurrent(data)**

```typescript
// existing code (lines 117-128)
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

// ====== Add here ======
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

#### 4.3.4 Scaling Forecast card UI modifications

**Replace entire Scaling Forecast card (lines 241-261)**

Existing code:

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

Replacement Code:

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

#### 4.3.5 Add forecast chart (optional)

**Added after System Health section but before Total Saved Card** (near line 302)

```typescript
          {/* System Health */}
          <div className="mb-4">
            {/* ... existing System Health code ... */}
          </div>

{/* ====== Add here ====== */}
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

### 5.1 GET /api/scaler (extension)

#### Request

```
GET /api/scaler
```

#### Response (extended)

```typescript
interface ScalerGetResponse {
// existing field
  currentVcpu: number;
  currentMemoryGiB: number;
  lastScalingTime: string | null;
  lastDecision: ScalingDecision | null;
  cooldownRemaining: number;
  autoScalingEnabled: boolean;
  simulationMode: boolean;
  timestamp: string;

// New field: prediction information
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

// New field: Predicted metadata
  predictionMeta: {
    metricsCount: number;
    minRequired: number;
    nextPredictionIn: number;
    isReady: boolean;
  };
}
```

#### Example response

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

## 6. Complete AI Prompts

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

## 7. Environment Variables

This proposal **only uses existing environment variables**, so no additional environment variables are required.

**Existing environment variables used:**

| variable | Use | Required |
|------|------|------|
| `AI_GATEWAY_URL` | AI Gateway Endpoint | Yes |
| `ANTHROPIC_API_KEY` | AI API authentication key | Yes |

---

## 8. Test Verification

### 8.1 API testing (curl)

#### Verify MetricsStore data collection

```bash
# Start collecting metrics (collected automatically every minute, can be called manually during development)
for i in {1..15}; do
  curl -s http://localhost:3002/api/metrics | jq '.metrics.cpuUsage'
  sleep 5
done
```

#### Predictive API testing

```bash
# Check scaler status including prediction data
curl -s http://localhost:3002/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  prediction: .prediction,
  predictionMeta: .predictionMeta
}'
```

#### Expected output (if there is enough data)

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

#### Expected output (when data is insufficient)

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

### 8.2 UI verification scenario

#### Scenario 1: Collecting data

1. Access the dashboard immediately after starting the application
2. Check the display of “Collecting Data...” in the “Scaling Forecast” card.
3. The progress bar is filled with the ratio `metricsCount/minRequired`
4. Start displaying predicted data after 10 minutes

#### Scenario 2: Normal forecast display

1. After collecting sufficient data (10+ data points)
2. Show forecast vCPUs in “Scaling Forecast” card
3. Check Current → Predicted visualization
4. Check the operation of the trend direction arrow icon
5. Check the Key Factors list display

#### Scenario 3: When predicting scale-up

1. Activate Stress Mode
2. Simulate CPU usage spikes
3. Verify that the forecast changes to the “scale_up” recommendation
4. Verify that the badge color changes to orange

### 8.3 Edge Cases

| case | Expected Behavior |
|--------|----------|
| AI Gateway connection failure | Use fallback prediction (confidence 0.5) |
| Less than 10 data | prediction: null, isReady: false |
| Re-request within 5 minutes cooldown | return cached prediction |
| All metrics 0 | stable prediction, low confidence |
| AI returns incorrect JSON | Use fallback prediction |

---

## 9. Dependencies

### 9.1 Shared modules

`src/lib/metrics-store.ts` will be shared and used in the following proposals:

| Proposal | Purpose of use |
|--------|----------|
| Proposal 2: Anomaly Detection | Anomaly pattern analysis |
| Proposal 3: Resource Analytics | Resource Usage Statistics |
| Proposal 4: Cost Optimization | Cost Optimization Analysis |

### 9.2 Independent implementation possible

This proposal (Proposal 1) **does not depend on any other proposals** and can be implemented completely independently.

### 9.3 Recommended implementation order

1. `src/types/prediction.ts` - Type definitions
2. `src/lib/metrics-store.ts` - shared module
3. `src/lib/predictive-scaler.ts` - Prediction logic
4. `src/lib/prediction-tracker.ts` - Accuracy tracking
5. Modify `src/app/api/metrics/route.ts`
6. Modify `src/app/api/scaler/route.ts`
7. Edit `src/app/page.tsx`

---

## 10. Checklist (Implementation Checklist)

After completing implementation, check the following items:

- [ ] TypeScript strict mode no errors
- [ ] `npm run lint` passed
- [ ] `npm run build` success
- [ ] Check data accumulation in MetricsStore (count output to console.log)
- [ ] Check prediction creation after 10 or more data points
- [ ] AI Gateway call succeeds (or fallback operation)
- [ ] Normal display of forecast information in UI
- [ ] Check 5 minute cooldown operation
- [ ] Appropriate fallback processing when an error occurs

---

## Appendix: File Structure

```
src/
├── types/
│ ├── scaling.ts # existing (no changes)
│ └── prediction.ts # New
├── lib/
│ ├── scaling-decision.ts # existing (no changes)
│ ├── k8s-scaler.ts # Existing (no changes)
│ ├── ai-analyzer.ts # existing (no changes)
│ ├── metrics-store.ts # New (shared module)
│ ├── predictive-scaler.ts # new
│ └── prediction-tracker.ts # New
├── app/
│   ├── api/
│   │   ├── metrics/
│ │ │ └── route.ts # Edit
│   │   └── scaler/
│ │ └── route.ts # edit
│ └── page.tsx # Edit
```

---

*End of document*
