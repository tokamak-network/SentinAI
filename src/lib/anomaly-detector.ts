/**
 * Layer 1: Statistical Anomaly Detector
 * Z-Score and rule-based metric anomaly detection
 *
 * NOTE: Adapts to the existing MetricDataPoint type from prediction.ts
 * which uses `blockHeight` and `blockInterval` (not `l2BlockHeight`/`l2BlockInterval`).
 */

import { MetricDataPoint } from '@/types/prediction';
import { AnomalyResult, AnomalyMetric, AnomalyDirection } from '@/types/anomaly';

// ============================================================================
// Configuration
// ============================================================================

/** Z-Score anomaly threshold (anomaly if |z| > 3.0) */
const Z_SCORE_THRESHOLD = 3.0;

/** Block plateau detection time (seconds) - anomaly if no change for 2+ minutes */
const BLOCK_PLATEAU_SECONDS = 120;

/** TxPool monotonic increase detection time (seconds) - anomaly if continuously increasing for 5 minutes */
const TXPOOL_MONOTONIC_SECONDS = 300;

/** Minimum number of history data points (skip detection if fewer) */
const MIN_HISTORY_POINTS = 5;

/**
 * Minimum standard deviation thresholds per metric.
 * When stdDev is below these values, the metric is considered stable
 * and Z-Score detection is skipped to prevent false positives from
 * tiny fluctuations (e.g., CPU oscillating between 0.15 and 0.18).
 */
const MIN_STD_DEV: Partial<Record<string, number>> = {
  cpuUsage: 0.02,        // 2% CPU — below this, variation is noise
  gasUsedRatio: 0.01,    // 1% gas ratio — near-zero chains produce noise
  txPoolPending: 5,      // 5 tx — small pool changes are normal
  l2BlockInterval: 0.3,  // 0.3s — natural jitter in block timing
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Calculate Z-Score
 * @param value Current value
 * @param mean Mean
 * @param stdDev Standard deviation
 * @returns Z-Score (returns 0 if standard deviation is 0)
 */
export function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

/**
 * Calculate mean
 */
function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
 * Helper: parse timestamp from MetricDataPoint (supports both string ISO and number ms)
 */
function parseTimestamp(ts: string | number): number {
  if (typeof ts === 'number') return ts;
  return new Date(ts).getTime();
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

  // Skip detection when variance is too low (metric is stable, not anomalous)
  const minStd = MIN_STD_DEV[metric];
  if (minStd && stdDev < minStd) return null;

  const zScore = calculateZScore(currentValue, mean, stdDev);

  // Special-case: for l2BlockInterval, only treat slowdowns (interval increases)
  // as anomalies. Faster block production (interval decreases) can be normal
  // depending on network configuration and should not trigger alerts.
  const isL2BlockInterval = metric === 'l2BlockInterval';
  const exceedsThreshold = isL2BlockInterval
    ? zScore > Z_SCORE_THRESHOLD
    : Math.abs(zScore) > Z_SCORE_THRESHOLD;

  if (exceedsThreshold) {
    const direction: AnomalyDirection = zScore > 0 ? 'spike' : 'drop';
    return {
      isAnomaly: true,
      metric,
      value: currentValue,
      zScore,
      direction,
      description: `${metric} ${direction === 'spike' ? 'spike' : 'drop'}: current ${currentValue.toFixed(2)}, mean ${mean.toFixed(2)}, Z-Score ${zScore.toFixed(2)}`,
      rule: 'z-score',
    };
  }

  return null;
}

/**
 * Detect CPU 0% drop (suspected process crash)
 */
function detectCpuZeroDrop(
  currentCpu: number,
  history: MetricDataPoint[]
): AnomalyResult | null {
  if (history.length < 3) return null;

  // If average CPU of the last 3 data points was >= 10% and suddenly dropped to 0%
  const recentCpuValues = history.slice(-3).map(p => p.cpuUsage);
  const recentMean = calculateMean(recentCpuValues);

  if (currentCpu < 1 && recentMean >= 10) {
    return {
      isAnomaly: true,
      metric: 'cpuUsage',
      value: currentCpu,
      zScore: -10, // Arbitrary large negative value (drop to 0)
      direction: 'drop',
      description: `CPU usage dropped to 0%: previous avg ${recentMean.toFixed(1)}% → current ${currentCpu.toFixed(1)}%. Suspected process crash.`,
      rule: 'zero-drop',
    };
  }

  return null;
}

/**
 * Detect L2 block height plateau (suspected Sequencer stall)
 */
function detectBlockPlateau(
  currentHeight: number,
  history: MetricDataPoint[]
): AnomalyResult | null {
  if (history.length < 2) return null;

  const now = Date.now();
  const oldestRelevant = now - BLOCK_PLATEAU_SECONDS * 1000;

  // Filter data within BLOCK_PLATEAU_SECONDS
  const recentHistory = history.filter(p => parseTimestamp(p.timestamp) >= oldestRelevant);
  if (recentHistory.length < 2) return null;

  // Check if all block heights are the same
  const allSameHeight = recentHistory.every(p => p.blockHeight === currentHeight);

  if (allSameHeight && recentHistory.length >= 2) {
    const durationSec = (now - parseTimestamp(recentHistory[0].timestamp)) / 1000;

    if (durationSec >= BLOCK_PLATEAU_SECONDS) {
      return {
        isAnomaly: true,
        metric: 'l2BlockHeight',
        value: currentHeight,
        zScore: 0,
        direction: 'plateau',
        description: `L2 block height unchanged for ${durationSec.toFixed(0)}s (height: ${currentHeight}). Suspected Sequencer stall.`,
        rule: 'plateau',
      };
    }
  }

  return null;
}

/**
 * Detect TxPool monotonic increase (suspected Batcher failure)
 */
function detectTxPoolMonotonicIncrease(
  currentTxPool: number,
  history: MetricDataPoint[]
): AnomalyResult | null {
  if (history.length < 5) return null;

  const now = Date.now();
  const oldestRelevant = now - TXPOOL_MONOTONIC_SECONDS * 1000;

  // Filter data within TXPOOL_MONOTONIC_SECONDS
  const recentHistory = history.filter(p => parseTimestamp(p.timestamp) >= oldestRelevant);
  if (recentHistory.length < 5) return null;

  // Check monotonic increase (each successive value >= previous)
  let isMonotonic = true;
  for (let i = 1; i < recentHistory.length; i++) {
    if (recentHistory[i].txPoolPending < recentHistory[i - 1].txPoolPending) {
      isMonotonic = false;
      break;
    }
  }

  // Current value must also be >= last historical value
  const lastHistoryValue = recentHistory[recentHistory.length - 1].txPoolPending;
  if (currentTxPool < lastHistoryValue) {
    isMonotonic = false;
  }

  if (isMonotonic) {
    const startValue = recentHistory[0].txPoolPending;
    const increase = currentTxPool - startValue;
    if (increase <= 0) return null;
    const durationSec = (now - parseTimestamp(recentHistory[0].timestamp)) / 1000;

    return {
      isAnomaly: true,
      metric: 'txPoolPending',
      value: currentTxPool,
      zScore: 0,
      direction: 'spike',
      description: `TxPool monotonically increasing for ${durationSec.toFixed(0)}s: ${startValue} → ${currentTxPool} (+${increase}). Suspected Batcher failure.`,
      rule: 'monotonic-increase',
    };
  }

  return null;
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Detect all anomalies from current metric data
 *
 * @param current Current metric data point
 * @param history Recent history (at least 5 recommended, up to 30 minutes)
 * @returns List of detected anomalies (empty array if none)
 *
 * @example
 * ```typescript
 * import { detectAnomalies } from '@/lib/anomaly-detector';
 * import { getRecentMetrics } from '@/lib/metrics-store';
 *
 * const current: MetricDataPoint = { ... };
 * const history = getRecentMetrics(30); // Last 30 points
 * const anomalies = detectAnomalies(current, history);
 *
 * if (anomalies.length > 0) {
 *   // Trigger Layer 2 AI analysis
 * }
 * ```
 */
export function detectAnomalies(
  current: MetricDataPoint,
  history: MetricDataPoint[],
  balances?: { batcherBalanceEth?: number; proposerBalanceEth?: number }
): AnomalyResult[] {
  const anomalies: AnomalyResult[] = [];

  // Skip detection if insufficient history
  if (history.length < MIN_HISTORY_POINTS) {
    return anomalies;
  }

  // 1. CPU 0% drop detection (most critical, check first)
  const cpuZeroDrop = detectCpuZeroDrop(current.cpuUsage, history);
  if (cpuZeroDrop) {
    anomalies.push(cpuZeroDrop);
  }

  // 2. L2 block height plateau detection
  const blockPlateau = detectBlockPlateau(current.blockHeight, history);
  if (blockPlateau) {
    anomalies.push(blockPlateau);
  }

  // 3. TxPool monotonic increase detection
  const txPoolMonotonic = detectTxPoolMonotonicIncrease(current.txPoolPending, history);
  if (txPoolMonotonic) {
    anomalies.push(txPoolMonotonic);
  }

  // 4. Z-Score based anomaly detection (for metrics not already detected by above rules)
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
    current.blockInterval,
    history.map(p => p.blockInterval)
  );
  if (intervalAnomaly) anomalies.push(intervalAnomaly);

  // 5. EOA Balance threshold detection (not Z-Score based)
  if (balances) {
    const batcherAnomaly = detectLowBalance(balances.batcherBalanceEth, 'batcherBalance');
    if (batcherAnomaly) anomalies.push(batcherAnomaly);

    const proposerAnomaly = detectLowBalance(balances.proposerBalanceEth, 'proposerBalance');
    if (proposerAnomaly) anomalies.push(proposerAnomaly);
  }

  return anomalies;
}

/**
 * Detect low EOA balance using fixed thresholds (not statistical Z-Score).
 * Triggers anomaly when balance falls below critical threshold.
 */
function detectLowBalance(
  balanceEth: number | undefined,
  metric: AnomalyMetric
): AnomalyResult | null {
  if (balanceEth === undefined) return null;

  const criticalThreshold = parseFloat(process.env.EOA_BALANCE_CRITICAL_ETH || '0.1');
  const role = metric === 'batcherBalance' ? 'Batcher' : 'Proposer';

  if (balanceEth < criticalThreshold) {
    return {
      isAnomaly: true,
      metric,
      value: balanceEth,
      zScore: 0,
      direction: 'drop',
      description: `${role} EOA balance critical: ${balanceEth.toFixed(4)} ETH (< ${criticalThreshold} ETH)`,
      rule: 'threshold-breach',
    };
  }

  return null;
}

/**
 * Return detector configuration defaults (for testing/config UI)
 */
export function getDetectorConfig() {
  return {
    zScoreThreshold: Z_SCORE_THRESHOLD,
    blockPlateauSeconds: BLOCK_PLATEAU_SECONDS,
    txPoolMonotonicSeconds: TXPOOL_MONOTONIC_SECONDS,
    minHistoryPoints: MIN_HISTORY_POINTS,
  };
}
