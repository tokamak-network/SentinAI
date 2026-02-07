/**
 * Layer 1: Statistical Anomaly Detector
 * Z-Score 및 규칙 기반 메트릭 이상 탐지
 *
 * NOTE: Adapts to the existing MetricDataPoint type from prediction.ts
 * which uses `blockHeight` and `blockInterval` (not `l2BlockHeight`/`l2BlockInterval`).
 */

import { MetricDataPoint } from '@/types/prediction';
import { AnomalyResult, AnomalyMetric, AnomalyDirection } from '@/types/anomaly';

// ============================================================================
// Configuration
// ============================================================================

/** Z-Score 이상 판단 임계값 (|z| > 2.5이면 이상) */
const Z_SCORE_THRESHOLD = 2.5;

/** 블록 정체 판단 시간 (초) - 2분 이상 변화 없으면 이상 */
const BLOCK_PLATEAU_SECONDS = 120;

/** TxPool 단조 증가 판단 시간 (초) - 5분간 계속 증가하면 이상 */
const TXPOOL_MONOTONIC_SECONDS = 300;

/** 최소 히스토리 데이터 포인트 수 (이보다 적으면 탐지 스킵) */
const MIN_HISTORY_POINTS = 5;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Z-Score 계산
 * @param value 현재 값
 * @param mean 평균
 * @param stdDev 표준편차
 * @returns Z-Score (표준편차가 0이면 0 반환)
 */
export function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

/**
 * 평균 계산
 */
function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * 표준편차 계산
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
 * Z-Score 기반 이상 탐지
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
      description: `${metric} ${direction === 'spike' ? '급증' : '급락'}: 현재 ${currentValue.toFixed(2)}, 평균 ${mean.toFixed(2)}, Z-Score ${zScore.toFixed(2)}`,
      rule: 'z-score',
    };
  }

  return null;
}

/**
 * CPU 0% 급락 탐지 (프로세스 크래시 의심)
 */
function detectCpuZeroDrop(
  currentCpu: number,
  history: MetricDataPoint[]
): AnomalyResult | null {
  if (history.length < 3) return null;

  // 이전 3개 데이터 포인트의 CPU 평균이 10% 이상이었는데 갑자기 0%로 떨어진 경우
  const recentCpuValues = history.slice(-3).map(p => p.cpuUsage);
  const recentMean = calculateMean(recentCpuValues);

  if (currentCpu < 1 && recentMean >= 10) {
    return {
      isAnomaly: true,
      metric: 'cpuUsage',
      value: currentCpu,
      zScore: -10, // 임의의 큰 음수 (0으로 급락)
      direction: 'drop',
      description: `CPU 사용률 0%로 급락: 이전 평균 ${recentMean.toFixed(1)}% → 현재 ${currentCpu.toFixed(1)}%. 프로세스 크래시 의심.`,
      rule: 'zero-drop',
    };
  }

  return null;
}

/**
 * L2 블록 높이 정체 탐지 (Sequencer 중단 의심)
 */
function detectBlockPlateau(
  currentHeight: number,
  history: MetricDataPoint[]
): AnomalyResult | null {
  if (history.length < 2) return null;

  const now = Date.now();
  const oldestRelevant = now - BLOCK_PLATEAU_SECONDS * 1000;

  // BLOCK_PLATEAU_SECONDS 내의 데이터만 필터링
  const recentHistory = history.filter(p => parseTimestamp(p.timestamp) >= oldestRelevant);
  if (recentHistory.length < 2) return null;

  // 모든 블록 높이가 동일한지 확인
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
        description: `L2 블록 높이 ${durationSec.toFixed(0)}초간 변화 없음 (높이: ${currentHeight}). Sequencer 중단 의심.`,
        rule: 'plateau',
      };
    }
  }

  return null;
}

/**
 * TxPool 단조 증가 탐지 (Batcher 장애 의심)
 */
function detectTxPoolMonotonicIncrease(
  currentTxPool: number,
  history: MetricDataPoint[]
): AnomalyResult | null {
  if (history.length < 5) return null;

  const now = Date.now();
  const oldestRelevant = now - TXPOOL_MONOTONIC_SECONDS * 1000;

  // TXPOOL_MONOTONIC_SECONDS 내의 데이터만 필터링
  const recentHistory = history.filter(p => parseTimestamp(p.timestamp) >= oldestRelevant);
  if (recentHistory.length < 5) return null;

  // 단조 증가 여부 확인 (모든 연속 쌍에서 후자가 전자 이상)
  let isMonotonic = true;
  for (let i = 1; i < recentHistory.length; i++) {
    if (recentHistory[i].txPoolPending < recentHistory[i - 1].txPoolPending) {
      isMonotonic = false;
      break;
    }
  }

  // 현재 값도 마지막 값보다 크거나 같아야 함
  const lastHistoryValue = recentHistory[recentHistory.length - 1].txPoolPending;
  if (currentTxPool < lastHistoryValue) {
    isMonotonic = false;
  }

  if (isMonotonic) {
    const startValue = recentHistory[0].txPoolPending;
    const increase = currentTxPool - startValue;
    const durationSec = (now - parseTimestamp(recentHistory[0].timestamp)) / 1000;

    return {
      isAnomaly: true,
      metric: 'txPoolPending',
      value: currentTxPool,
      zScore: 0,
      direction: 'spike',
      description: `TxPool ${durationSec.toFixed(0)}초간 단조 증가: ${startValue} → ${currentTxPool} (+${increase}). Batcher 장애 의심.`,
      rule: 'monotonic-increase',
    };
  }

  return null;
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * 현재 메트릭 데이터에서 모든 이상을 탐지
 *
 * @param current 현재 메트릭 데이터 포인트
 * @param history 최근 히스토리 (최소 5개 권장, 최대 30분)
 * @returns 탐지된 이상 목록 (없으면 빈 배열)
 *
 * @example
 * ```typescript
 * import { detectAnomalies } from '@/lib/anomaly-detector';
 * import { getRecentMetrics } from '@/lib/metrics-store';
 *
 * const current: MetricDataPoint = { ... };
 * const history = getRecentMetrics(30); // 최근 30개
 * const anomalies = detectAnomalies(current, history);
 *
 * if (anomalies.length > 0) {
 *   // Layer 2 AI 분석 트리거
 * }
 * ```
 */
export function detectAnomalies(
  current: MetricDataPoint,
  history: MetricDataPoint[]
): AnomalyResult[] {
  const anomalies: AnomalyResult[] = [];

  // 히스토리가 너무 적으면 탐지 스킵
  if (history.length < MIN_HISTORY_POINTS) {
    return anomalies;
  }

  // 1. CPU 0% 급락 탐지 (가장 심각한 상황, 먼저 체크)
  const cpuZeroDrop = detectCpuZeroDrop(current.cpuUsage, history);
  if (cpuZeroDrop) {
    anomalies.push(cpuZeroDrop);
  }

  // 2. L2 블록 높이 정체 탐지
  const blockPlateau = detectBlockPlateau(current.blockHeight, history);
  if (blockPlateau) {
    anomalies.push(blockPlateau);
  }

  // 3. TxPool 단조 증가 탐지
  const txPoolMonotonic = detectTxPoolMonotonicIncrease(current.txPoolPending, history);
  if (txPoolMonotonic) {
    anomalies.push(txPoolMonotonic);
  }

  // 4. Z-Score 기반 이상 탐지 (위 규칙에서 이미 탐지되지 않은 메트릭에 대해)
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

  return anomalies;
}

/**
 * 이상 탐지 설정을 기본값으로 반환 (테스트/설정 UI용)
 */
export function getDetectorConfig() {
  return {
    zScoreThreshold: Z_SCORE_THRESHOLD,
    blockPlateauSeconds: BLOCK_PLATEAU_SECONDS,
    txPoolMonotonicSeconds: TXPOOL_MONOTONIC_SECONDS,
    minHistoryPoints: MIN_HISTORY_POINTS,
  };
}
