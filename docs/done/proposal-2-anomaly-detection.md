# Proposal 2: Anomaly Detection Pipeline - Implementation Specification

> Version: 1.0.0
> Creation date: 2026-02-06
> Target audience: Claude Opus 4.6 Implementation Agent
> Dependency: Proposal 1 (MetricsStore) required

---

## 1. Overview

### 1.1 Purpose

This document is a complete specification for implementing SentinAI's **Multi-Layer Anomaly Detection Pipeline** from scratch. You should be able to implement the entire functionality with just this document.

### 1.2 Architecture Overview

```
Layer 1: Statistical Detector        Layer 2: AI Semantic Analyzer
┌─────────────────────────┐          ┌───────────────────────────┐
│ Z-Score based │ │ Claude based log+metric │
│ Metric outlier detection │─────────▶│ Context analysis │
│ (Local operation, low cost) │ In case of abnormality │ (API call, high cost) │
└─────────────────────────┘          └─────────────┬─────────────┘
                                                    │
                                     ┌──────────────▼──────────────┐
                                     │ Layer 3: Alert Dispatcher   │
                                     │ Slack / Webhook / Dashboard │
                                     └─────────────────────────────┘
```

### 1.3 Core principles

1. **Cost-effective**: Reduce unnecessary AI calls by 70-90% with Layer 1 statistical filters
2. **Real-time**: Layer 1 detection performed every metric polling cycle (1 second)
3. **Accuracy**: Minimize false positives through AI semantic analysis
4. **Operation convenience**: Instant recognition with Slack/Webhook notifications

### 1.4 Dependencies

- **Required**: `src/lib/metrics-store.ts` (implemented in Proposal 1)
- **Required**: `src/types/prediction.ts` (`MetricDataPoint` defined in Proposal 1)
- **Provided**: Anomaly detection results are used as input in Proposal 3 (RCA Engine)

---

## 2. Type definition

### 2.1 File: `src/types/anomaly.ts` (new)

```typescript
/**
 * Anomaly Detection Pipeline Types
* Type definition for multi-layer anomaly detection system
 */

import { AISeverity } from './scaling';

// ============================================================================
// Layer 1: Statistical Anomaly Detection
// ============================================================================

/**
* Ideal direction
* - spike: sudden rise
* - drop: sudden drop
* - plateau: no change for a long time (stagnation)
 */
export type AnomalyDirection = 'spike' | 'drop' | 'plateau';

/**
* Metrics to be detected
 */
export type AnomalyMetric =
  | 'cpuUsage'
  | 'txPoolPending'
  | 'gasUsedRatio'
  | 'l2BlockHeight'
  | 'l2BlockInterval';

/**
* Layer 1 statistics-based anomaly detection results
 */
export interface AnomalyResult {
/** Is there a problem */
  isAnomaly: boolean;
/** Metric with anomaly detected */
  metric: AnomalyMetric;
/** Current value */
  value: number;
/** Z-Score (distance in standard deviation from the mean) */
  zScore: number;
/** Ideal direction */
  direction: AnomalyDirection;
/** Human-readable description */
  description: string;
/** Detection rule (by which rule it was detected) */
  rule: 'z-score' | 'zero-drop' | 'plateau' | 'monotonic-increase';
}

// ============================================================================
// Layer 2: AI Semantic Analysis
// ============================================================================

/**
* Classification of abnormality types
 */
export type AnomalyType = 'performance' | 'security' | 'consensus' | 'liveness';

/**
* Layer 2 AI in-depth analysis results
 */
export interface DeepAnalysisResult {
/** Severity determined by AI */
  severity: AISeverity;
/** abnormal type */
  anomalyType: AnomalyType;
/** Associated metrics/log patterns */
  correlations: string[];
/** Expected impact */
  predictedImpact: string;
/** List of recommended actions */
  suggestedActions: string[];
/** Affected components */
  relatedComponents: string[];
/** Analysis timestamp */
  timestamp: string;
/** Source of AI model response (for debugging) */
  rawResponse?: string;
}

// ============================================================================
// Layer 3: Alert Dispatch
// ============================================================================

/**
* Notification channel type
 */
export type AlertChannel = 'slack' | 'webhook' | 'dashboard';

/**
* Notification settings
 */
export interface AlertConfig {
/** Slack/Discord webhook URL (optional) */
  webhookUrl?: string;
/** Set notification threshold */
  thresholds: {
/** Send notifications at this severity or higher */
    notifyOn: AISeverity[];
/** Notification interval for the same type or more (minutes) */
    cooldownMinutes: number;
  };
/** Whether to enable notifications */
  enabled: boolean;
}

/**
* Records of notifications sent
 */
export interface AlertRecord {
/** Unique ID */
  id: string;
/** Caused abnormality detection result */
  anomaly: AnomalyResult;
/** AI deep analysis results (if any) */
  analysis?: DeepAnalysisResult;
/** Shipping time */
  sentAt: string;
/** Shipping channel */
  channel: AlertChannel;
/** Whether sending was successful */
  success: boolean;
/** Error message in case of failure */
  error?: string;
}

// ============================================================================
// Anomaly Event (integrated)
// ============================================================================

/**
* Abnormal event status
 */
export type AnomalyEventStatus = 'active' | 'resolved' | 'acknowledged';

/**
* Abnormal event (Integration of Layer 1~3 results)
 */
export interface AnomalyEvent {
/** Unique ID (UUID v4) */
  id: string;
/** First detection time (Unix timestamp ms) */
  timestamp: number;
/** List of anomalies detected in Layer 1 */
  anomalies: AnomalyResult[];
/** Layer 2 AI in-depth analysis results (if performed) */
  deepAnalysis?: DeepAnalysisResult;
/** Event status */
  status: AnomalyEventStatus;
/** Resolution time (if any) */
  resolvedAt?: number;
/** Log of sent notifications */
  alerts: AlertRecord[];
}

// ============================================================================
// API Types
// ============================================================================

/**
* GET /api/anomalies response
 */
export interface AnomaliesResponse {
/** List of abnormal events (in order of most recent) */
  events: AnomalyEvent[];
/** Total number of events */
  total: number;
/** Current active anomaly count */
  activeCount: number;
}

/**
* GET /api/anomalies/config response
 */
export interface AlertConfigResponse {
  config: AlertConfig;
/** Number of notifications sent in the last 24 hours */
  alertsSent24h: number;
/** Next notification time (if on cooldown) */
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
/** Layer 1 abnormality detection results (real-time) */
  anomalies: AnomalyResult[];
/** Currently active anomaly event ID (if any) */
  activeEventId?: string;
}
```

---

## 3. New file specification

### 3.1 `src/lib/anomaly-detector.ts` (Layer 1 - statistics-based detector)

#### 3.1.1 Purpose

A low-cost, statistics-based anomaly detector that runs locally at every metric collection. Anomalies are determined by combining Z-Score and rule-based detection.

#### 3.1.2 Full code

```typescript
/**
 * Layer 1: Statistical Anomaly Detector
* Z-Score and rule-based metric anomaly detection
 */

import { MetricDataPoint } from '@/types/prediction';
import { AnomalyResult, AnomalyMetric, AnomalyDirection } from '@/types/anomaly';

// ============================================================================
// Configuration
// ============================================================================

/** Z-Score abnormality judgment threshold (if |z| > 2.5) */
const Z_SCORE_THRESHOLD = 2.5;

/** Block congestion determination time (seconds) - If there is no change for more than 2 minutes, it is abnormal */
const BLOCK_PLATEAU_SECONDS = 120;

/** TxPool monotonically increasing judgment time (seconds) - abnormal if it continues to increase for 5 minutes */
const TXPOOL_MONOTONIC_SECONDS = 300;

/** Minimum number of historical data points (skip detection if less) */
const MIN_HISTORY_POINTS = 5;

// ============================================================================
// Core Functions
// ============================================================================

/**
* Z-Score calculation
* @param value Current value
* @param mean mean
* @param stdDev standard deviation
* @returns Z-Score (if standard deviation is 0, 0 is returned)
 */
export function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

/**
* Calculate average
 */
function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
* Standard deviation calculation
 */
function calculateStdDev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
* Z-Score based anomaly detection
 */
function detectZScoreAnomaly(
  metric: AnomalyMetric,
  currentValue: number,
  historicalValues: number[]
): AnomalyResult | null {
  if (historicalValues.length < MIN_HISTORY_POINTS) return null;

  const mean = calculateMean(historicalValues);
  const stdDev = calculateStdDev(historicalValues, mean);
  const zScore = calculateZScore(currentValue, mean, stdDev);

  if (Math.abs(zScore) > Z_SCORE_THRESHOLD) {
    const direction: AnomalyDirection = zScore > 0 ? 'spike' : 'drop';
    return {
      isAnomaly: true,
      metric,
      value: currentValue,
      zScore,
      direction,
description: `${metric} ${direction === 'spike' ? 'Surge' : 'Plumb'}: Current ${currentValue.toFixed(2)}, Average ${mean.toFixed(2)}, Z-Score ${zScore.toFixed(2)}`,
      rule: 'z-score',
    };
  }

  return null;
}

/**
* 0% CPU drop detected (suspicious process crash)
 */
function detectCpuZeroDrop(
  currentCpu: number,
  history: MetricDataPoint[]
): AnomalyResult | null {
  if (history.length < 3) return null;

// If the CPU average for the previous 3 data points was above 10% but suddenly dropped to 0%
  const recentCpuValues = history.slice(-3).map(p => p.cpuUsage);
  const recentMean = calculateMean(recentCpuValues);

  if (currentCpu < 1 && recentMean >= 10) {
    return {
      isAnomaly: true,
      metric: 'cpuUsage',
      value: currentCpu,
zScore: -10, // arbitrarily large negative number (plummets to 0)
      direction: 'drop',
description: `CPU utilization plummets to 0%: previous average ${recentMean.toFixed(1)}% → current ${currentCpu.toFixed(1)}%. Suspected process crash.`,
      rule: 'zero-drop',
    };
  }

  return null;
}

/**
* L2 block height congestion detection (suspected sequencer interruption)
 */
function detectBlockPlateau(
  currentHeight: number,
  history: MetricDataPoint[]
): AnomalyResult | null {
  if (history.length < 2) return null;

  const now = Date.now();
  const oldestRelevant = now - BLOCK_PLATEAU_SECONDS * 1000;

// Filter only data within BLOCK_PLATEAU_SECONDS
  const recentHistory = history.filter(p => p.timestamp >= oldestRelevant);
  if (recentHistory.length < 2) return null;

// Check if all blocks have the same height
  const allSameHeight = recentHistory.every(p => p.l2BlockHeight === currentHeight);

  if (allSameHeight && recentHistory.length >= 2) {
    const durationSec = (now - recentHistory[0].timestamp) / 1000;

    if (durationSec >= BLOCK_PLATEAU_SECONDS) {
      return {
        isAnomaly: true,
        metric: 'l2BlockHeight',
        value: currentHeight,
        zScore: 0,
        direction: 'plateau',
description: `L2 block height does not change for ${durationSec.toFixed(0)} seconds (height: ${currentHeight}). Sequencer interruption suspected.`,
        rule: 'plateau',
      };
    }
  }

  return null;
}

/**
* TxPool monotonic increase detection (suspected Batcher failure)
 */
function detectTxPoolMonotonicIncrease(
  currentTxPool: number,
  history: MetricDataPoint[]
): AnomalyResult | null {
  if (history.length < 5) return null;

  const now = Date.now();
  const oldestRelevant = now - TXPOOL_MONOTONIC_SECONDS * 1000;

// Filter only data within TXPOOL_MONOTONIC_SECONDS
  const recentHistory = history.filter(p => p.timestamp >= oldestRelevant);
  if (recentHistory.length < 5) return null;

// Check if monotonically increasing (the latter is greater than the former in all consecutive pairs)
  let isMonotonic = true;
  for (let i = 1; i < recentHistory.length; i++) {
    if (recentHistory[i].txPoolPending < recentHistory[i - 1].txPoolPending) {
      isMonotonic = false;
      break;
    }
  }

// The current value must also be greater than or equal to the last value
  const lastHistoryValue = recentHistory[recentHistory.length - 1].txPoolPending;
  if (currentTxPool < lastHistoryValue) {
    isMonotonic = false;
  }

  if (isMonotonic) {
    const startValue = recentHistory[0].txPoolPending;
    const increase = currentTxPool - startValue;
    const durationSec = (now - recentHistory[0].timestamp) / 1000;

    return {
      isAnomaly: true,
      metric: 'txPoolPending',
      value: currentTxPool,
      zScore: 0,
      direction: 'spike',
description: `TxPool Monotonically increase in ${durationSec.toFixed(0)} seconds: ${startValue} → ${currentTxPool} (+${increase}). Suspected Batcher failure.`,
      rule: 'monotonic-increase',
    };
  }

  return null;
}

// ============================================================================
// Main Export
// ============================================================================

/**
* Detect all anomalies in current metric data
 *
* @param current Current metric data point
* @param history Recent history (minimum 5 recommended, maximum 30 minutes)
* @returns list of detected anomalies (empty array if none)
 *
 * @example
 * ```typescript
 * import { detectAnomalies } from '@/lib/anomaly-detector';
 * import { getRecent } from '@/lib/metrics-store';
 *
 * const current: MetricDataPoint = { ... };
* const history = getRecent(30); // Last 30 minutes
 * const anomalies = detectAnomalies(current, history);
 *
 * if (anomalies.length > 0) {
* // Layer 2 AI analysis trigger
 * }
 * ```
 */
export function detectAnomalies(
  current: MetricDataPoint,
  history: MetricDataPoint[]
): AnomalyResult[] {
  const anomalies: AnomalyResult[] = [];

// Skip detection if history is too small
  if (history.length < MIN_HISTORY_POINTS) {
    return anomalies;
  }

// 1. CPU 0% drop detection (most serious situation, check first)
  const cpuZeroDrop = detectCpuZeroDrop(current.cpuUsage, history);
  if (cpuZeroDrop) {
    anomalies.push(cpuZeroDrop);
  }

// 2. L2 block height congestion detection
  const blockPlateau = detectBlockPlateau(current.l2BlockHeight, history);
  if (blockPlateau) {
    anomalies.push(blockPlateau);
  }

// 3. TxPool monotonically increasing detection
  const txPoolMonotonic = detectTxPoolMonotonicIncrease(current.txPoolPending, history);
  if (txPoolMonotonic) {
    anomalies.push(txPoolMonotonic);
  }

// 4. Z-Score based anomaly detection (for metrics not already detected by the above rules)
  const detectedMetrics = new Set(anomalies.map(a => a.metric));

  // CPU Usage Z-Score
  if (!detectedMetrics.has('cpuUsage')) {
    const cpuAnomaly = detectZScoreAnomaly(
      'cpuUsage',
      current.cpuUsage,
      history.map(p => p.cpuUsage)
    );
    if (cpuAnomaly) anomalies.push(cpuAnomaly);
  }

  // TxPool Z-Score
  if (!detectedMetrics.has('txPoolPending')) {
    const txPoolAnomaly = detectZScoreAnomaly(
      'txPoolPending',
      current.txPoolPending,
      history.map(p => p.txPoolPending)
    );
    if (txPoolAnomaly) anomalies.push(txPoolAnomaly);
  }

  // Gas Used Ratio Z-Score
  const gasAnomaly = detectZScoreAnomaly(
    'gasUsedRatio',
    current.gasUsedRatio,
    history.map(p => p.gasUsedRatio)
  );
  if (gasAnomaly) anomalies.push(gasAnomaly);

  // L2 Block Interval Z-Score
  const intervalAnomaly = detectZScoreAnomaly(
    'l2BlockInterval',
    current.l2BlockInterval,
    history.map(p => p.l2BlockInterval)
  );
  if (intervalAnomaly) anomalies.push(intervalAnomaly);

  return anomalies;
}

/**
* Return anomaly detection settings to default (for testing/settings UI)
 */
export function getDetectorConfig() {
  return {
    zScoreThreshold: Z_SCORE_THRESHOLD,
    blockPlateauSeconds: BLOCK_PLATEAU_SECONDS,
    txPoolMonotonicSeconds: TXPOOL_MONOTONIC_SECONDS,
    minHistoryPoints: MIN_HISTORY_POINTS,
  };
}
```

---

### 3.2 `src/lib/anomaly-ai-analyzer.ts` (Layer 2 - AI Semantic Analyzer)

#### 3.2.1 Purpose

AI-based deep analyzer that is called only when an abnormality is determined at Layer 1. Anomaly metrics + logs are delivered to Claude to perform context-based analysis.

#### 3.2.2 Full code

```typescript
/**
 * Layer 2: AI Semantic Anomaly Analyzer
* Claude-based abnormal context analysis
 */

import { MetricDataPoint } from '@/types/prediction';
import { AnomalyResult, DeepAnalysisResult, AnomalyType } from '@/types/anomaly';
import { AISeverity } from '@/types/scaling';

// ============================================================================
// Configuration
// ============================================================================

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

/** Minimum interval between AI calls (milliseconds) - 1 minute */
const MIN_AI_CALL_INTERVAL_MS = 60 * 1000;

/** Latest analysis result cache TTL (milliseconds) - 5 minutes */
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;

// ============================================================================
// In-Memory State
// ============================================================================

/** Last AI call time */
let lastAICallTime = 0;

/** Cache recent analysis results */
interface AnalysisCache {
  result: DeepAnalysisResult;
  anomalyHash: string;
  timestamp: number;
}
let analysisCache: AnalysisCache | null = null;

// ============================================================================
// System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are a Senior SRE for an Optimism L2 Rollup Network performing anomaly analysis.

Your task is to analyze detected anomalies in the context of:
1. **Metrics data** - CPU, TxPool, Gas, Block intervals
2. **Component logs** - op-geth, op-node, op-batcher, op-proposer
3. **Known failure patterns** for Optimism Rollups

## Optimism Component Relationships:
- **op-node** derives L2 state from L1, feeds to all other components
- **op-geth** executes transactions, depends on op-node
- **op-batcher** submits transaction batches to L1, depends on op-node
- **op-proposer** submits state roots to L1, depends on op-node

## Common Failure Patterns:
1. **L1 Reorg** → op-node derivation reset → temporary sync stall
2. **L1 Gas Spike** → batcher unable to post → txpool accumulation
3. **op-geth Crash** → CPU drops to 0% → all downstream affected
4. **Network Partition** → P2P gossip failure → unsafe head divergence
5. **Sequencer Stall** → block height plateau → txpool growth

## Analysis Guidelines:
- Correlate anomalies: multiple symptoms often share a root cause
- Consider timing: which anomaly appeared first?
- Check logs for error messages, warnings, state changes
- Assess impact: how does this affect end users?

Return ONLY a JSON object (no markdown code blocks):
{
  "severity": "low" | "medium" | "high" | "critical",
  "anomalyType": "performance" | "security" | "consensus" | "liveness",
  "correlations": ["correlation1", "correlation2"],
  "predictedImpact": "description of expected impact",
  "suggestedActions": ["action1", "action2"],
  "relatedComponents": ["op-geth", "op-node"]
}`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
* Generate a hash of the anomaly list (for cache keys)
 */
function hashAnomalies(anomalies: AnomalyResult[]): string {
  const sorted = anomalies
    .map(a => `${a.metric}:${a.rule}:${a.direction}`)
    .sort()
    .join('|');
  return sorted;
}

/**
* Convert anomaly list to text for AI prompts
 */
function formatAnomaliesForPrompt(anomalies: AnomalyResult[]): string {
  return anomalies
    .map((a, i) => `${i + 1}. [${a.metric}] ${a.description} (rule: ${a.rule}, z-score: ${a.zScore.toFixed(2)})`)
    .join('\n');
}

/**
* Convert metrics to text for AI prompts
 */
function formatMetricsForPrompt(metrics: MetricDataPoint): string {
  return `
- CPU Usage: ${metrics.cpuUsage.toFixed(2)}%
- TxPool Pending: ${metrics.txPoolPending}
- Gas Used Ratio: ${(metrics.gasUsedRatio * 100).toFixed(2)}%
- L2 Block Height: ${metrics.l2BlockHeight}
- L2 Block Interval: ${metrics.l2BlockInterval.toFixed(2)}s
- Timestamp: ${new Date(metrics.timestamp).toISOString()}`;
}

/**
* Convert logs to text for AI prompts
 */
function formatLogsForPrompt(logs: Record<string, string>): string {
  let result = '';
  for (const [component, log] of Object.entries(logs)) {
// If the log is too long, only the last 1000 characters
    const truncatedLog = log.length > 1000 ? '...' + log.slice(-1000) : log;
    result += `\n[${component}]\n${truncatedLog}\n`;
  }
  return result;
}

/**
* AI response parsing
 */
function parseAIResponse(content: string): DeepAnalysisResult {
// Remove Markdown code block
  const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();

  try {
    const parsed = JSON.parse(jsonStr);

// Required field validation and default values
    const severity: AISeverity =
      ['low', 'medium', 'high', 'critical'].includes(parsed.severity)
        ? parsed.severity
        : 'medium';

    const anomalyType: AnomalyType =
      ['performance', 'security', 'consensus', 'liveness'].includes(parsed.anomalyType)
        ? parsed.anomalyType
        : 'performance';

    return {
      severity,
      anomalyType,
      correlations: Array.isArray(parsed.correlations) ? parsed.correlations : [],
      predictedImpact: typeof parsed.predictedImpact === 'string' ? parsed.predictedImpact : 'Unknown impact',
      suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [],
      relatedComponents: Array.isArray(parsed.relatedComponents) ? parsed.relatedComponents : [],
      timestamp: new Date().toISOString(),
      rawResponse: content,
    };
  } catch {
// Default response when JSON parsing fails
    return {
      severity: 'medium',
      anomalyType: 'performance',
      correlations: [],
predictedImpact: 'AI response parsing failed. Original: ' + content.substring(0, 200);
suggestedActions: ['Require manual checking of logs'],
      relatedComponents: [],
      timestamp: new Date().toISOString(),
      rawResponse: content,
    };
  }
}

// ============================================================================
// Main Export
// ============================================================================

/**
* Perform AI in-depth analysis of detected anomalies
 *
* @param anomalies List of anomalies detected in Layer 1
* @param metrics Current metrics data
* @param logs Logs for each component (op-geth, op-node, etc.)
* @returns AI in-depth analysis results
 *
 * @remarks
* - AI call only at intervals of at least 1 minute (rate limiting)
* - The same abnormal pattern returns results cached for 5 minutes
* - Return default response when AI Gateway call fails
 *
 * @example
 * ```typescript
 * import { analyzeAnomalies } from '@/lib/anomaly-ai-analyzer';
 *
 * const analysis = await analyzeAnomalies(
 *   anomalies,
 *   currentMetrics,
 *   { 'op-geth': gethLogs, 'op-node': nodeLogs }
 * );
 * ```
 */
export async function analyzeAnomalies(
  anomalies: AnomalyResult[],
  metrics: MetricDataPoint,
  logs: Record<string, string>
): Promise<DeepAnalysisResult> {
  const now = Date.now();

// 1. Cache check: If the pattern is the same or higher, cached results are returned.
  const anomalyHash = hashAnomalies(anomalies);
  if (analysisCache &&
      analysisCache.anomalyHash === anomalyHash &&
      now - analysisCache.timestamp < ANALYSIS_CACHE_TTL_MS) {
    console.log('[AnomalyAIAnalyzer] Returning cached analysis');
    return analysisCache.result;
  }

// 2. Rate limiting: Return cached results or default response when the minimum interval is not met.
  if (now - lastAICallTime < MIN_AI_CALL_INTERVAL_MS) {
    console.log('[AnomalyAIAnalyzer] Rate limited, returning cached or default');
    if (analysisCache) {
      return analysisCache.result;
    }
    return {
      severity: 'medium',
      anomalyType: 'performance',
      correlations: [],
predictedImpact: 'Rate limited - awaiting analysis',
suggestedActions: ['Try again later'],
      relatedComponents: [],
      timestamp: new Date().toISOString(),
    };
  }

// 3. Configure User prompt
  const userPrompt = `## Detected Anomalies
${formatAnomaliesForPrompt(anomalies)}

## Current Metrics
${formatMetricsForPrompt(metrics)}

## Recent Component Logs
${formatLogsForPrompt(logs)}

Analyze these anomalies and provide your assessment.`;

// 4. Call AI Gateway
  try {
    console.log(`[AnomalyAIAnalyzer] Calling AI Gateway with ${anomalies.length} anomalies...`);
    lastAICallTime = now;

    const response = await fetch(`${AI_GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'claude-haiku-4.5',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`Gateway responded with ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || data.output || '{}';

    const result = parseAIResponse(content);

// 5. Cache update
    analysisCache = {
      result,
      anomalyHash,
      timestamp: now,
    };

    console.log(`[AnomalyAIAnalyzer] Analysis complete: severity=${result.severity}, type=${result.anomalyType}`);
    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AnomalyAIAnalyzer] AI Gateway Error:', errorMessage);

// default response in case of failure
    return {
      severity: 'medium',
      anomalyType: 'performance',
      correlations: anomalies.map(a => a.description),
predictedImpact: `AI analysis failed: ${errorMessage}`,
suggestedActions: ['Require manual checking of logs and metrics', 'Check AI Gateway connection status'],
      relatedComponents: [],
      timestamp: new Date().toISOString(),
    };
  }
}

/**
* Initialize analysis cache (for testing)
 */
export function clearAnalysisCache(): void {
  analysisCache = null;
  lastAICallTime = 0;
}

/**
* Check current rate limit status
 */
export function getRateLimitStatus(): { canCall: boolean; nextAvailableAt: number } {
  const now = Date.now();
  const canCall = now - lastAICallTime >= MIN_AI_CALL_INTERVAL_MS;
  const nextAvailableAt = lastAICallTime + MIN_AI_CALL_INTERVAL_MS;
  return { canCall, nextAvailableAt };
}
```

---

### 3.3 `src/lib/alert-dispatcher.ts` (Layer 3 - Notification dispatcher)

#### 3.3.1 Purpose

Anomaly analysis results are sent to Slack/Webhook, and cooldown and duplicate notification prevention are managed.

#### 3.3.2 Full code

```typescript
/**
 * Layer 3: Alert Dispatcher
* Slack/Webhook notification sending and cooldown management
 */

import { MetricDataPoint } from '@/types/prediction';
import {
  DeepAnalysisResult,
  AlertConfig,
  AlertRecord,
  AlertChannel,
  AnomalyResult
} from '@/types/anomaly';
import { AISeverity } from '@/types/scaling';

// ============================================================================
// Configuration Defaults
// ============================================================================

const DEFAULT_ALERT_CONFIG: AlertConfig = {
  webhookUrl: process.env.ALERT_WEBHOOK_URL,
  thresholds: {
    notifyOn: ['high', 'critical'],
    cooldownMinutes: 10,
  },
  enabled: true,
};

// ============================================================================
// In-Memory State
// ============================================================================

/** Current notification settings */
let currentConfig: AlertConfig = { ...DEFAULT_ALERT_CONFIG };

/** Notification sending record (last 24 hours) */
let alertHistory: AlertRecord[] = [];

/** Last notification time by anomaly type */
const lastAlertByType: Map<string, number> = new Map();

// ============================================================================
// Slack Message Formatting
// ============================================================================

/**
* Create message in Slack Block Kit format
 */
export function formatSlackMessage(
  analysis: DeepAnalysisResult,
  metrics: MetricDataPoint,
  anomalies: AnomalyResult[]
): object {
  const severityEmoji: Record<AISeverity, string> = {
    low: ':large_blue_circle:',
    medium: ':large_yellow_circle:',
    high: ':large_orange_circle:',
    critical: ':red_circle:',
  };

  const typeEmoji: Record<string, string> = {
    performance: ':chart_with_upwards_trend:',
    security: ':shield:',
    consensus: ':link:',
    liveness: ':heartbeat:',
  };

  const anomalySummary = anomalies
    .map(a => `• \`${a.metric}\`: ${a.description}`)
    .join('\n');

  const actionsList = analysis.suggestedActions
    .map((action, i) => `${i + 1}. ${action}`)
    .join('\n');

  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${severityEmoji[analysis.severity]} SentinAI Anomaly Alert`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Severity:*\n${analysis.severity.toUpperCase()}`,
          },
          {
            type: 'mrkdwn',
            text: `*Type:*\n${typeEmoji[analysis.anomalyType]} ${analysis.anomalyType}`,
          },
          {
            type: 'mrkdwn',
            text: `*Components:*\n${analysis.relatedComponents.join(', ') || 'Unknown'}`,
          },
          {
            type: 'mrkdwn',
            text: `*Time:*\n${new Date().toISOString()}`,
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Detected Anomalies:*\n${anomalySummary}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Impact:*\n${analysis.predictedImpact}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Correlations:*\n${analysis.correlations.join(', ') || 'None identified'}`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Suggested Actions:*\n${actionsList || 'No specific actions recommended'}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Current Metrics: CPU ${metrics.cpuUsage.toFixed(1)}% | TxPool ${metrics.txPoolPending} | Block #${metrics.l2BlockHeight}`,
          },
        ],
      },
    ],
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
* UUID v4 generation (simple implementation)
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
* Cooldown check
 */
function isInCooldown(anomalyType: string): boolean {
  const lastAlert = lastAlertByType.get(anomalyType);
  if (!lastAlert) return false;

  const cooldownMs = currentConfig.thresholds.cooldownMinutes * 60 * 1000;
  return Date.now() - lastAlert < cooldownMs;
}

/**
* Check if the severity is subject to notification
 */
function shouldNotifyForSeverity(severity: AISeverity): boolean {
  return currentConfig.thresholds.notifyOn.includes(severity);
}

/**
* Clean up old notification records (older than 24 hours)
 */
function cleanupOldAlerts(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  alertHistory = alertHistory.filter(a => new Date(a.sentAt).getTime() > cutoff);
}

// ============================================================================
// Main Export
// ============================================================================

/**
* Send notifications
 *
* @param analysis AI in-depth analysis results
* @param metrics Current metrics
* @param anomalies List of detected anomalies
* @returns Record of notifications sent (null if not sent)
 *
 * @remarks
* - Do not send if the setting is disabled
* - Do not send if severity is not included in notifyOn
* - Does not resend within cooldown time for the same type or higher
* - If there is no webhookUrl, it is recorded only as a dashboard channel.
 */
export async function dispatchAlert(
  analysis: DeepAnalysisResult,
  metrics: MetricDataPoint,
  anomalies: AnomalyResult[]
): Promise<AlertRecord | null> {
  cleanupOldAlerts();

// 1. Check activation
  if (!currentConfig.enabled) {
    console.log('[AlertDispatcher] Alerts disabled, skipping');
    return null;
  }

// 2. Check severity
  if (!shouldNotifyForSeverity(analysis.severity)) {
    console.log(`[AlertDispatcher] Severity ${analysis.severity} not in notify list, skipping`);
    return null;
  }

// 3. Cooldown check
  if (isInCooldown(analysis.anomalyType)) {
    console.log(`[AlertDispatcher] Anomaly type ${analysis.anomalyType} in cooldown, skipping`);
    return null;
  }

// 4. Create notification record
  const record: AlertRecord = {
    id: generateUUID(),
anomaly: anomalies[0], // more than representative
    analysis,
    sentAt: new Date().toISOString(),
    channel: currentConfig.webhookUrl ? 'slack' : 'dashboard',
    success: false,
  };

// 5. Send webhook (if URL exists)
  if (currentConfig.webhookUrl) {
    try {
      const slackMessage = formatSlackMessage(analysis, metrics, anomalies);

      const response = await fetch(currentConfig.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackMessage),
      });

      if (!response.ok) {
        throw new Error(`Webhook responded with ${response.status}`);
      }

      record.success = true;
      console.log(`[AlertDispatcher] Alert sent to Slack: ${analysis.severity} ${analysis.anomalyType}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      record.error = errorMessage;
      console.error('[AlertDispatcher] Webhook error:', errorMessage);
    }
  } else {
// Dashboard-only notifications
    record.success = true;
    console.log(`[AlertDispatcher] Dashboard alert recorded: ${analysis.severity} ${analysis.anomalyType}`);
  }

// 6. Status update
  lastAlertByType.set(analysis.anomalyType, Date.now());
  alertHistory.push(record);

  return record;
}

// ============================================================================
// Configuration Management
// ============================================================================

/**
* View current notification settings
 */
export function getAlertConfig(): AlertConfig {
  return { ...currentConfig };
}

/**
* Updated notification settings
 */
export function updateAlertConfig(updates: Partial<AlertConfig>): AlertConfig {
  if (updates.webhookUrl !== undefined) {
    currentConfig.webhookUrl = updates.webhookUrl;
  }
  if (updates.enabled !== undefined) {
    currentConfig.enabled = updates.enabled;
  }
  if (updates.thresholds) {
    if (updates.thresholds.notifyOn) {
      currentConfig.thresholds.notifyOn = updates.thresholds.notifyOn;
    }
    if (updates.thresholds.cooldownMinutes !== undefined) {
      currentConfig.thresholds.cooldownMinutes = updates.thresholds.cooldownMinutes;
    }
  }
  return { ...currentConfig };
}

/**
* Check recent 24-hour notification history
 */
export function getAlertHistory(): AlertRecord[] {
  cleanupOldAlerts();
  return [...alertHistory];
}

/**
* Check the next available notification time (if on cooldown)
 */
export function getNextAlertAvailableAt(anomalyType: string): number | null {
  const lastAlert = lastAlertByType.get(anomalyType);
  if (!lastAlert) return null;

  const cooldownMs = currentConfig.thresholds.cooldownMinutes * 60 * 1000;
  const nextAvailable = lastAlert + cooldownMs;

  return Date.now() < nextAvailable ? nextAvailable : null;
}

/**
* Reset notification history (for testing)
 */
export function clearAlertHistory(): void {
  alertHistory = [];
  lastAlertByType.clear();
}
```

---

### 3.4 `src/lib/anomaly-event-store.ts` (anomaly event store)

#### 3.4.1 Purpose

Detected abnormal events are stored and managed in memory. Used for queries and status updates in the API.

#### 3.4.2 Full code

```typescript
/**
 * Anomaly Event Store
* Detected abnormal event memory storage
 */

import { AnomalyEvent, AnomalyResult, DeepAnalysisResult, AlertRecord, AnomalyEventStatus } from '@/types/anomaly';

// ============================================================================
// Configuration
// ============================================================================

/** Maximum number of events stored */
const MAX_EVENTS = 100;

/** Event automatic resolution time (milliseconds) - If there are no new issues for 30 minutes, resolution will be processed */
const AUTO_RESOLVE_MS = 30 * 60 * 1000;

// ============================================================================
// In-Memory State
// ============================================================================

/** Event repository (most recent) */
let events: AnomalyEvent[] = [];

/** Current active event ID */
let activeEventId: string | null = null;

// ============================================================================
// Helper Functions
// ============================================================================

/**
* Generate UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
* Clean up old events
 */
function cleanup(): void {
// If the maximum number is exceeded, remove the oldest ones first.
  if (events.length > MAX_EVENTS) {
    events = events.slice(0, MAX_EVENTS);
  }

// automatic resolution processing
  const now = Date.now();
  for (const event of events) {
    if (event.status === 'active' && now - event.timestamp > AUTO_RESOLVE_MS) {
      event.status = 'resolved';
      event.resolvedAt = now;
    }
  }

// Update active event ID
  const activeEvent = events.find(e => e.status === 'active');
  activeEventId = activeEvent?.id || null;
}

// ============================================================================
// Main Exports
// ============================================================================

/**
* Create a new anomaly event or add to an existing active event
 *
* @param anomalies List of anomalies detected in Layer 1
* @returns Created/updated event
 */
export function createOrUpdateEvent(anomalies: AnomalyResult[]): AnomalyEvent {
  cleanup();
  const now = Date.now();

// Update anomaly list if there are active events
  if (activeEventId) {
    const activeEvent = events.find(e => e.id === activeEventId);
    if (activeEvent) {
// Only add abnormalities of new metrics that are not present in existing abnormalities
      const existingMetrics = new Set(activeEvent.anomalies.map(a => a.metric));
      const newAnomalies = anomalies.filter(a => !existingMetrics.has(a.metric));

      if (newAnomalies.length > 0) {
        activeEvent.anomalies.push(...newAnomalies);
      }

// Update existing error (if the metric is the same, use the latest value)
      for (const anomaly of anomalies) {
        const existingIndex = activeEvent.anomalies.findIndex(a => a.metric === anomaly.metric);
        if (existingIndex >= 0) {
          activeEvent.anomalies[existingIndex] = anomaly;
        }
      }

      return activeEvent;
    }
  }

// create new event
  const newEvent: AnomalyEvent = {
    id: generateUUID(),
    timestamp: now,
    anomalies,
    status: 'active',
    alerts: [],
  };

  events.unshift(newEvent);
  activeEventId = newEvent.id;

  return newEvent;
}

/**
* Add AI analysis results to events
 */
export function addDeepAnalysis(eventId: string, analysis: DeepAnalysisResult): void {
  const event = events.find(e => e.id === eventId);
  if (event) {
    event.deepAnalysis = analysis;
  }
}

/**
* Added notification history to events
 */
export function addAlertRecord(eventId: string, alert: AlertRecord): void {
  const event = events.find(e => e.id === eventId);
  if (event) {
    event.alerts.push(alert);
  }
}

/**
* Event status updates
 */
export function updateEventStatus(eventId: string, status: AnomalyEventStatus): void {
  const event = events.find(e => e.id === eventId);
  if (event) {
    event.status = status;
    if (status === 'resolved') {
      event.resolvedAt = Date.now();
    }
    if (status !== 'active' && activeEventId === eventId) {
      activeEventId = null;
    }
  }
}

/**
* Handle active event resolution (called when anomaly is no longer detected)
 */
export function resolveActiveEventIfExists(): void {
  if (activeEventId) {
    updateEventStatus(activeEventId, 'resolved');
  }
}

/**
* Event list inquiry (pagination)
 */
export function getEvents(limit: number = 20, offset: number = 0): { events: AnomalyEvent[]; total: number; activeCount: number } {
  cleanup();

  const activeCount = events.filter(e => e.status === 'active').length;
  const paginatedEvents = events.slice(offset, offset + limit);

  return {
    events: paginatedEvents,
    total: events.length,
    activeCount,
  };
}

/**
* Look up specific events
 */
export function getEventById(eventId: string): AnomalyEvent | null {
  return events.find(e => e.id === eventId) || null;
}

/**
* Look up currently active event ID
 */
export function getActiveEventId(): string | null {
  cleanup();
  return activeEventId;
}

/**
* Initialize storage (for testing)
 */
export function clearEvents(): void {
  events = [];
  activeEventId = null;
}
```

---

### 3.5 `src/app/api/anomalies/route.ts` (anomaly event API)

#### 3.5.1 Full code

```typescript
/**
 * Anomalies API
* GET: View abnormal event list
 */

import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/anomaly-event-store';
import { AnomaliesResponse } from '@/types/anomaly';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse<AnomaliesResponse>> {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

// Validation
  const validLimit = Math.min(Math.max(1, limit), 100);
  const validOffset = Math.max(0, offset);

  const result = getEvents(validLimit, validOffset);

  return NextResponse.json({
    events: result.events,
    total: result.total,
    activeCount: result.activeCount,
  });
}
```

---

### 3.6 `src/app/api/anomalies/config/route.ts` (Notification Settings API)

#### 3.6.1 Full code

```typescript
/**
 * Anomaly Alert Config API
* GET: View current notification settings
* POST: Update notification settings
 */

import { NextResponse } from 'next/server';
import {
  getAlertConfig,
  updateAlertConfig,
  getAlertHistory
} from '@/lib/alert-dispatcher';
import { AlertConfigResponse, AlertConfigUpdateRequest } from '@/types/anomaly';
import { AISeverity } from '@/types/scaling';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<AlertConfigResponse>> {
  const config = getAlertConfig();
  const history = getAlertHistory();

// Count the number of notifications in the last 24 hours
  const alertsSent24h = history.length;

// Next notification time (based on most recent notification)
  let nextAlertAvailableAt: string | undefined;
  if (history.length > 0) {
    const lastAlert = history[history.length - 1];
    const lastAlertTime = new Date(lastAlert.sentAt).getTime();
    const cooldownMs = config.thresholds.cooldownMinutes * 60 * 1000;
    const nextAvailable = lastAlertTime + cooldownMs;

    if (Date.now() < nextAvailable) {
      nextAlertAvailableAt = new Date(nextAvailable).toISOString();
    }
  }

  return NextResponse.json({
    config,
    alertsSent24h,
    nextAlertAvailableAt,
  });
}

export async function POST(request: Request): Promise<NextResponse<AlertConfigResponse | { error: string }>> {
  try {
    const body: AlertConfigUpdateRequest = await request.json();

// Validation
    if (body.thresholds?.notifyOn) {
      const validSeverities: AISeverity[] = ['low', 'medium', 'high', 'critical'];
      const invalidSeverities = body.thresholds.notifyOn.filter(s => !validSeverities.includes(s));
      if (invalidSeverities.length > 0) {
        return NextResponse.json(
          { error: `Invalid severity values: ${invalidSeverities.join(', ')}` },
          { status: 400 }
        );
      }
    }

    if (body.thresholds?.cooldownMinutes !== undefined) {
      if (body.thresholds.cooldownMinutes < 1 || body.thresholds.cooldownMinutes > 1440) {
        return NextResponse.json(
          { error: 'cooldownMinutes must be between 1 and 1440 (24 hours)' },
          { status: 400 }
        );
      }
    }

// update settings
    const updatedConfig = updateAlertConfig({
      webhookUrl: body.webhookUrl,
      enabled: body.enabled,
      thresholds: body.thresholds,
    });

    const history = getAlertHistory();

    return NextResponse.json({
      config: updatedConfig,
      alertsSent24h: history.length,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to update config: ${errorMessage}` },
      { status: 500 }
    );
  }
}
```

---

## 4. Edit existing files

### 4.1 Modify `src/app/api/metrics/route.ts`

#### 4.1.1 Purpose of modification

When collecting every metric, Layer 1 anomaly detection is performed, and when an anomaly is detected, Layer 2 AI analysis is triggered asynchronously.

#### 4.1.2 Changes

**Add import at the top of the file:**

```typescript
// Add below existing import
import { MetricDataPoint } from '@/types/prediction';
import { push as pushToMetricsStore, getRecent } from '@/lib/metrics-store';
import { detectAnomalies } from '@/lib/anomaly-detector';
import { analyzeAnomalies } from '@/lib/anomaly-ai-analyzer';
import { dispatchAlert } from '@/lib/alert-dispatcher';
import {
  createOrUpdateEvent,
  addDeepAnalysis,
  addAlertRecord,
  resolveActiveEventIfExists,
  getActiveEventId
} from '@/lib/anomaly-event-store';
import { getAllLiveLogs } from '@/lib/log-ingester';
import { AnomalyResult } from '@/types/anomaly';
```

**Add environment variable check (top of file):**

```typescript
// Whether to enable anomaly detection (default: enabled)
const ANOMALY_DETECTION_ENABLED = process.env.ANOMALY_DETECTION_ENABLED !== 'false';
```

**Inside the GET function, add anomaly detection logic just before returning the response:**

Insert the code below just before `const response = NextResponse.json({...})`.

```typescript
        // ================================================================
        // Anomaly Detection Pipeline (Layer 1 → Layer 2 → Layer 3)
        // ================================================================
        let detectedAnomalies: AnomalyResult[] = [];
        let activeAnomalyEventId: string | undefined;

        if (ANOMALY_DETECTION_ENABLED && !isStressTest) {
          try {
// 1. Push data to MetricsStore
            const previousBlock = await l2RpcClient.getBlock({ blockNumber: blockNumber - 1n }).catch(() => null);
            const blockInterval = previousBlock
              ? Number(block.timestamp) - Number(previousBlock.timestamp)
: 2; // default 2 seconds

            const dataPoint: MetricDataPoint = {
              timestamp: Date.now(),
              cpuUsage: effectiveCpu,
              txPoolPending: effectiveTx,
              gasUsedRatio: gasUsed / gasLimit,
              l2BlockHeight: Number(blockNumber),
              l2BlockInterval: blockInterval,
            };

            pushToMetricsStore(dataPoint);

// 2. Layer 1: Statistics-based anomaly detection
const history = getRecent(30); // Last 30 minutes
            detectedAnomalies = detectAnomalies(dataPoint, history);

            if (detectedAnomalies.length > 0) {
              console.log(`[Anomaly] Detected ${detectedAnomalies.length} anomalies`);

// 3. Record to event store
              const event = createOrUpdateEvent(detectedAnomalies);
              activeAnomalyEventId = event.id;

// 4. Layer 2: AI deep analysis (asynchronous, no response blocking)
// Trigger only if there is no first anomaly or deep dive yet
              if (!event.deepAnalysis) {
                (async () => {
                  try {
                    const logs = await getAllLiveLogs();
                    const analysis = await analyzeAnomalies(detectedAnomalies, dataPoint, logs);
                    addDeepAnalysis(event.id, analysis);

// 5. Layer 3: Send notification
                    const alertRecord = await dispatchAlert(analysis, dataPoint, detectedAnomalies);
                    if (alertRecord) {
                      addAlertRecord(event.id, alertRecord);
                    }
                  } catch (aiError) {
                    console.error('[Anomaly] AI analysis failed:', aiError);
                  }
                })();
              }
            } else {
// If all goes well, handle active event resolution
              resolveActiveEventIfExists();
              activeAnomalyEventId = getActiveEventId() || undefined;
            }
          } catch (anomalyError) {
            console.error('[Anomaly] Detection pipeline error:', anomalyError);
          }
        }
```

**Add anomalies field to response object:**

Add the following fields to the existing response JSON.

```typescript
        const response = NextResponse.json({
            timestamp: new Date().toISOString(),
            metrics: {
// ...keep existing fields...
            },
            components,
            cost: {
// ...keep existing fields...
            },
            status: "healthy",
            stressMode: isStressTest,
// === Add new field ===
            anomalies: detectedAnomalies,
            activeAnomalyEventId,
        });
```

---

### 4.2 Modify `src/app/page.tsx`

#### 4.2.1 Purpose of modification

- Display notification banner at the top when there is an active abnormal event
- Added anomaly detection feed to AI Monitor section

#### 4.2.2 Interface extensions

**Add fields to the MetricData interface:**

```typescript
interface MetricData {
// ...keep existing fields...
  anomalies?: AnomalyResult[];
  activeAnomalyEventId?: string;
}
```

**AnomalyResult type import (or local definition):**

```typescript
// add to top of file
interface AnomalyResult {
  isAnomaly: boolean;
  metric: string;
  value: number;
  zScore: number;
  direction: 'spike' | 'drop' | 'plateau';
  description: string;
  rule: string;
}
```

#### 4.2.3 Add status

```typescript
// add below existing state
const [activeAnomalies, setActiveAnomalies] = useState<AnomalyResult[]>([]);
```

#### 4.2.4 Modification of fetchData function

```typescript
// Add below existing setCurrent(data)
        if (data.anomalies && data.anomalies.length > 0) {
          setActiveAnomalies(data.anomalies);
        } else {
          setActiveAnomalies([]);
        }
```

#### 4.2.5 or later Add notification banner component (just below header)

```typescript
      {/* Anomaly Alert Banner */}
      {activeAnomalies.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-6 py-4 mb-6 animate-pulse">
          <div className="flex items-center gap-3">
            <ShieldAlert className="text-red-500" size={24} />
            <div className="flex-1">
              <h3 className="font-bold text-red-600">
                Anomaly Detected ({activeAnomalies.length})
              </h3>
              <p className="text-sm text-red-500/80">
                {activeAnomalies.map(a => a.description).join(' | ')}
              </p>
            </div>
            <button
              onClick={() => checkLogs('live')}
              className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-red-600 transition"
            >
              Analyze Now
            </button>
          </div>
        </div>
      )}
```

#### 4.2.6 Add anomaly feed in AI Monitor section

Add an anomaly detection feed to the Log Stream section of the AI ​​Monitor area.

```typescript
            {/* 1. Log Stream (Left) */}
            <div className="flex-1 bg-[#0D1117] p-6 overflow-y-auto font-mono text-sm custom-scrollbar relative">
              <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-[#0D1117] to-transparent pointer-events-none"></div>

              <div className="space-y-4">

{/* === Anomaly Detection Feed (new addition) === */}
                {activeAnomalies.length > 0 && (
                  <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                    <div className="flex items-center gap-2 mb-2">
                      <ShieldAlert size={14} className="text-red-500" />
                      <span className="text-red-400 font-bold text-xs uppercase">Real-time Anomalies</span>
                    </div>
                    {activeAnomalies.map((anomaly, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs mb-2 last:mb-0">
                        <span className={`shrink-0 font-bold ${
                          anomaly.direction === 'spike' ? 'text-red-500' :
                          anomaly.direction === 'drop' ? 'text-yellow-500' :
                          'text-orange-500'
                        }`}>
                          {anomaly.direction.toUpperCase()}
                        </span>
                        <span className="text-gray-400">[{anomaly.metric}]</span>
                        <span className="text-gray-300 break-all">{anomaly.description}</span>
                      </div>
                    ))}
                  </div>
                )}

{/* ... Maintain existing Stress Logs, Analyzing State, AI Result, etc. ... */}
```

---

## 5. API Specification

### 5.1 GET /api/anomalies

**Description**: View a list of abnormal events

**Request Parameters:**
| parameters | Type | default | Description |
|---------|------|--------|------|
| limit | number | 20 | Number of events to return (1-100) |
| offset | number | 0 | Number of events to skip |

**Example response:**
```json
{
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "timestamp": 1707235200000,
      "anomalies": [
        {
          "isAnomaly": true,
          "metric": "cpuUsage",
          "value": 0.5,
          "zScore": -8.5,
          "direction": "drop",
"description": "CPU utilization plummets to 0%: previous average 45.2% → current 0.5%. Process crash suspected.",
          "rule": "zero-drop"
        }
      ],
      "deepAnalysis": {
        "severity": "critical",
        "anomalyType": "liveness",
        "correlations": ["CPU crash detected", "Process termination suspected"],
"predictedImpact": "L2 node completely crashed, unable to process transactions",
"suggestedActions": ["Check op-geth process status", "Check kubectl logs", "Consider restarting node"],
        "relatedComponents": ["op-geth"],
        "timestamp": "2026-02-06T12:00:00.000Z"
      },
      "status": "resolved",
      "resolvedAt": 1707237000000,
      "alerts": [
        {
          "id": "alert-001",
          "anomaly": { "metric": "cpuUsage", "..." : "..." },
          "sentAt": "2026-02-06T12:00:01.000Z",
          "channel": "slack",
          "success": true
        }
      ]
    }
  ],
  "total": 15,
  "activeCount": 0
}
```

### 5.2 GET /api/anomalies/config

**Description**: View current notification settings

**Example response:**
```json
{
  "config": {
    "webhookUrl": "https://hooks.slack.com/services/xxx/yyy/zzz",
    "thresholds": {
      "notifyOn": ["high", "critical"],
      "cooldownMinutes": 10
    },
    "enabled": true
  },
  "alertsSent24h": 3,
  "nextAlertAvailableAt": "2026-02-06T12:15:00.000Z"
}
```

### 5.3 POST /api/anomalies/config

**Description**: Updated notification settings

**Request Body:**
```json
{
  "webhookUrl": "https://hooks.slack.com/services/new/webhook/url",
  "thresholds": {
    "notifyOn": ["medium", "high", "critical"],
    "cooldownMinutes": 5
  },
  "enabled": true
}
```

**Response**: Same format as GET /api/anomalies/config

### 5.4 GET /api/metrics (extension)

**Fields added to existing response:**

```json
{
  "timestamp": "...",
  "metrics": { "..." : "..." },
  "components": [],
  "cost": { "..." : "..." },
  "status": "healthy",
  "stressMode": false,
  "anomalies": [
    {
      "isAnomaly": true,
      "metric": "txPoolPending",
      "value": 1500,
      "zScore": 3.2,
      "direction": "spike",
"description": "TxPool monotonic increase for 300 seconds: 200 → 1500 (+1300). Suspected Batcher failure.",
      "rule": "monotonic-increase"
    }
  ],
  "activeAnomalyEventId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## 6. AI Prompt Professional

### 6.1 Layer 2 System Prompt (Full text)

```
You are a Senior SRE for an Optimism L2 Rollup Network performing anomaly analysis.

Your task is to analyze detected anomalies in the context of:
1. **Metrics data** - CPU, TxPool, Gas, Block intervals
2. **Component logs** - op-geth, op-node, op-batcher, op-proposer
3. **Known failure patterns** for Optimism Rollups

## Optimism Component Relationships:
- **op-node** derives L2 state from L1, feeds to all other components
- **op-geth** executes transactions, depends on op-node
- **op-batcher** submits transaction batches to L1, depends on op-node
- **op-proposer** submits state roots to L1, depends on op-node

## Common Failure Patterns:
1. **L1 Reorg** → op-node derivation reset → temporary sync stall
2. **L1 Gas Spike** → batcher unable to post → txpool accumulation
3. **op-geth Crash** → CPU drops to 0% → all downstream affected
4. **Network Partition** → P2P gossip failure → unsafe head divergence
5. **Sequencer Stall** → block height plateau → txpool growth

## Analysis Guidelines:
- Correlate anomalies: multiple symptoms often share a root cause
- Consider timing: which anomaly appeared first?
- Check logs for error messages, warnings, state changes
- Assess impact: how does this affect end users?

Return ONLY a JSON object (no markdown code blocks):
{
  "severity": "low" | "medium" | "high" | "critical",
  "anomalyType": "performance" | "security" | "consensus" | "liveness",
  "correlations": ["correlation1", "correlation2"],
  "predictedImpact": "description of expected impact",
  "suggestedActions": ["action1", "action2"],
  "relatedComponents": ["op-geth", "op-node"]
}
```

### 6.2 User Prompt Template

```
## Detected Anomalies
1. [cpuUsage] CPU usage plummets to 0%: previous average 45.2% → current 0.5%. Suspected process crash. (rule: zero-drop, z-score: -8.50)
2. [txPoolPending] TxPool monotonic increase for 300 seconds: 200 → 1500 (+1300). Suspected Batcher disorder. (rule: monotonic-increase, z-score: 0.00)

## Current Metrics
- CPU Usage: 0.50%
- TxPool Pending: 1500
- Gas Used Ratio: 45.00%
- L2 Block Height: 12345678
- L2 Block Interval: 2.00s
- Timestamp: 2026-02-06T12:00:00.000Z

## Recent Component Logs
[op-geth]
ERROR [2026-02-06T11:59:58] Process terminated unexpectedly
WARN [2026-02-06T11:59:55] Memory pressure detected
INFO [2026-02-06T11:59:50] Block imported #12345677

[op-node]
WARN [2026-02-06T12:00:00] Engine API not responding
INFO [2026-02-06T11:59:58] Derived block #12345677

[op-batcher]
WARN [2026-02-06T12:00:00] Unable to submit batch: engine unavailable
INFO [2026-02-06T11:59:55] Batch prepared, 50 transactions

[op-proposer]
INFO [2026-02-06T11:59:58] Output submitted for block #12345670

Analyze these anomalies and provide your assessment.
```

---

## 7. Environment variables

### 7.1 New environment variables

Add the following to `.env.local`:

```bash
# ========================================
# Anomaly Detection Configuration
# ========================================

# Whether to enable anomaly detection (default: true)
# Disable anomaly detection pipeline when set to 'false'
ANOMALY_DETECTION_ENABLED=true

# Slack/Discord webhook URL (optional)
# Send notification for high/critical abnormalities when setting
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### 7.2 Existing environment variables (reference)

Environment variables that should already be defined:

```bash
# AI Gateway (required)
AI_GATEWAY_URL=https://api.ai.tokamak.network
ANTHROPIC_API_KEY=your-api-key

# K8s (for log collection)
K8S_NAMESPACE=default
K8S_APP_PREFIX=op
```

---

## 8. Test verification

### 8.1 curl test command

**View list of abnormal events:**
```bash
curl -s http://localhost:3002/api/anomalies | jq
```

**Above event pagination:**
```bash
curl -s "http://localhost:3002/api/anomalies?limit=5&offset=0" | jq
```

**View notification settings:**
```bash
curl -s http://localhost:3002/api/anomalies/config | jq
```

**Updated notification settings:**
```bash
curl -s -X POST http://localhost:3002/api/anomalies/config \
  -H "Content-Type: application/json" \
  -d '{
    "webhookUrl": "https://hooks.slack.com/services/test",
    "thresholds": {
      "notifyOn": ["medium", "high", "critical"],
      "cooldownMinutes": 5
    },
    "enabled": true
  }' | jq
```

**Check for anomaly fields in Metrics API:**
```bash
curl -s http://localhost:3002/api/metrics | jq '.anomalies, .activeAnomalyEventId'
```

### 8.2 UI Test Scenario

**Scenario 1: Steady State**
1. Access dashboard
2. Anomaly notification banner is not displayed
3. No “Real-time Anomalies” section in AI Monitor

**Scenario 2: Anomaly Detection**
1. An anomaly is detected in a metric (e.g. TxPool spike)
2. Display a red abnormality notification banner at the top
3. Show “Real-time Anomalies” section in AI Monitor
4. Trigger AI analysis when clicking the “Analyze Now” button

**Scenario 3: Troubleshooting**
1. The cause of the problem has been resolved
2. The anomaly banner disappears after 30 minutes or when the next metric is collected.
3. The event status changes to “resolved” in /api/anomalies.

### 8.3 Edge cases

**Empty History:**
- When there are less than 5 data in MetricsStore
- Skip anomaly detection, return empty array

**All metrics normal:**
- Z-Score is below the threshold
- Rule-based detection is also not applicable
- Return empty array, handle active event resolution

**Continuous anomaly detection:**
- First abnormality → create new event, trigger AI analysis
- Second or later (after 1 second) → Add to existing event, do not retrigger AI analysis (rate limit)
- AI analysis completed → Notification sent (cooldown begins)
- Third time or more (after 5 minutes) → Added to existing event, does not resend due to notification cooldown

---

## 9. Dependencies and implementation order

### 9.1 Prerequisites

Before implementing this Proposal, **Proposal 1 (MetricsStore)** must be implemented first:

- `src/lib/metrics-store.ts` - `push()`, `getRecent()` 함수
- `src/types/prediction.ts` - `MetricDataPoint` 타입

### 9.2 Implementation order

| steps | file | Description |
|------|------|------|
| 1 | `src/types/anomaly.ts` | type definition |
| 2 | `src/lib/anomaly-detector.ts` | Layer 1 statistical detector |
| 3 | `src/lib/anomaly-ai-analyzer.ts` | Layer 2 AI Analyzer |
| 4 | `src/lib/alert-dispatcher.ts` | Layer 3 notification sender |
| 5 | `src/lib/anomaly-event-store.ts` | Event Store |
| 6 | `src/app/api/anomalies/route.ts` | Event API |
| 7 | `src/app/api/anomalies/config/route.ts` | Settings API |
| 8 | `src/app/api/metrics/route.ts` | Metric API Modification |
| 9 | `src/app/page.tsx` | Frontend Edit |

### 9.3 Linkage with follow-up proposals

**Used in Proposal 3 (RCA Engine):**
- Use `deepAnalysis` results of `AnomalyEvent` as input to RCA Engine
- Automatically triggers RCA when critical abnormality is detected

---

## 10. Summary of file structure

```
src/
├── types/
│ ├── scaling.ts # Existing (AISeverity, etc.)
│ ├── prediction.ts # Added from Proposal 1 (MetricDataPoint)
│ └── anomaly.ts # ★ New
├── lib/
│ ├── ai-analyzer.ts # Existing (log analysis)
│ ├── log-ingester.ts # existing (log collection)
│ ├── metrics-store.ts # Added in Proposal 1
│ ├── anomaly-detector.ts # ★ New (Layer 1)
│ ├── anomaly-ai-analyzer.ts # ★ New (Layer 2)
│ ├── alert-dispatcher.ts # ★ New (Layer 3)
│ └── anomaly-event-store.ts # ★ New
└── app/
    ├── api/
│ ├── metrics/route.ts # ★ Edit
    │   └── anomalies/
│ ├── route.ts # ★ New
│ └── config/route.ts # ★ New
└── page.tsx #★ Edit
```

---

## 11. Checklist

After completing implementation, check the following items:

- [ ] No error with `npm run lint`
- [ ] `npm run build` success
- [ ] GET /api/anomalies Normal response
- [ ] GET /api/anomalies/config Normal response
- [ ] POST /api/anomalies/config configuration update operation
- [ ] Include `anomalies` field in GET /api/metrics
- [ ] Abnormal banner not displayed in normal state
- Display banner when simulating above [ ]
- [ ] AI analysis trigger and result display
- [ ] Send Slack webhook notification (if set)
- [ ] Check cooldown operation

---

**End of document**
