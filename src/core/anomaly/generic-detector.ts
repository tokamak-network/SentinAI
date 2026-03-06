/**
 * Generic Anomaly Detector
 * Parameterized by MetricFieldDefinition[] — no hardcoded metric names.
 * Supports: z-score, threshold, rate-of-change, plateau detection.
 * Works for any protocol: L1 EL, L1 CL, L2 OP Stack, Arbitrum, ZK Stack.
 */
import type { MetricFieldDefinition } from '@/core/metrics'
import type { FieldAnomalyConfig } from '@/core/types'

export type AnomalyMethod = 'z-score' | 'threshold' | 'rate-of-change' | 'plateau'
export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical'

export interface FieldAnomaly {
  fieldName: string
  displayName: string
  method: AnomalyMethod
  currentValue: number
  /** Z-Score (z-score method only) */
  zScore?: number
  threshold?: number
  severity: AnomalySeverity
  message: string
}

export interface DetectionResult {
  instanceId: string
  timestamp: string
  anomalies: FieldAnomaly[]
  hasAnomaly: boolean
}

const DEFAULT_Z_THRESHOLD = parseFloat(process.env.ANOMALY_Z_SCORE_THRESHOLD ?? '3.0')
const DEFAULT_SUSTAINED_COUNT = parseInt(process.env.ANOMALY_SUSTAINED_COUNT ?? '3', 10)

// ============================================================
// Sustained Anomaly Tracker (per instanceId:fieldName)
// ============================================================

const globalForTracker = globalThis as unknown as {
  __sentinai_v2_zscore_streak?: Map<string, number>
}

function getStreakMap(): Map<string, number> {
  if (!globalForTracker.__sentinai_v2_zscore_streak) {
    globalForTracker.__sentinai_v2_zscore_streak = new Map()
  }
  return globalForTracker.__sentinai_v2_zscore_streak
}

function incrementStreak(key: string, threshold: number): boolean {
  const map = getStreakMap()
  const current = (map.get(key) ?? 0) + 1
  map.set(key, current)
  return current >= threshold
}

function resetStreak(key: string): void {
  getStreakMap().delete(key)
}

/** Export for testing */
export function resetAllStreaks(): void {
  globalForTracker.__sentinai_v2_zscore_streak = undefined
}

function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0
  return Math.abs((value - mean) / stdDev)
}

function severityFromZ(z: number): AnomalySeverity {
  if (z >= 5) return 'critical'
  if (z >= 4) return 'high'
  if (z >= 3) return 'medium'
  return 'low'
}

/**
 * Run anomaly detection on a single field value.
 *
 * @param fieldDef - MetricFieldDefinition describing the field
 * @param anomalyConfig - Per-field detection config
 * @param currentValue - The current metric value
 * @param history - Recent values for statistical methods (newest last)
 * @param instanceId - Instance ID for sustained anomaly tracking (optional, default: '_')
 * @returns FieldAnomaly if detected, null otherwise
 */
export function detectFieldAnomaly(
  fieldDef: MetricFieldDefinition,
  anomalyConfig: FieldAnomalyConfig,
  currentValue: number,
  history: number[],
  instanceId?: string
): FieldAnomaly | null {
  if (!anomalyConfig.enabled || history.length < 3) return null

  const mean = history.reduce((s, v) => s + v, 0) / history.length
  const variance = history.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / history.length
  const stdDev = Math.sqrt(variance)

  switch (anomalyConfig.method) {
    case 'z-score': {
      const zThreshold = anomalyConfig.zScoreThreshold ?? DEFAULT_Z_THRESHOLD
      const z = calculateZScore(currentValue, mean, stdDev)
      const streakKey = `${instanceId ?? '_'}:${fieldDef.fieldName}`
      if (z < zThreshold) {
        resetStreak(streakKey)
        return null
      }
      const sustained = incrementStreak(streakKey, DEFAULT_SUSTAINED_COUNT)
      if (!sustained) return null
      const streakCount = getStreakMap().get(streakKey) ?? 1
      return {
        fieldName: fieldDef.fieldName,
        displayName: fieldDef.displayName,
        method: 'z-score',
        currentValue,
        zScore: z,
        severity: severityFromZ(z),
        message: `${fieldDef.displayName} 이상 감지 (Z-Score: ${z.toFixed(2)}, 평균: ${mean.toFixed(1)}, 지속 ${streakCount}회)`,
      }
    }

    case 'threshold': {
      const critical = anomalyConfig.criticalThreshold
      const warning = anomalyConfig.warningThreshold

      if (critical !== undefined) {
        // For balance/peer count: below threshold is bad
        const isBelowCritical = currentValue < critical
        // For high-value fields (cpu, gas): above threshold is bad
        const isAboveCritical = currentValue > critical
        const fieldUnit = fieldDef.unit
        const isHighValueField = fieldUnit === 'percent' || fieldUnit === 'ratio'

        if ((isHighValueField && isAboveCritical) || (!isHighValueField && isBelowCritical)) {
          return {
            fieldName: fieldDef.fieldName,
            displayName: fieldDef.displayName,
            method: 'threshold',
            currentValue,
            threshold: critical,
            severity: 'critical',
            message: `${fieldDef.displayName} 임계값 초과 (현재: ${currentValue}, 임계값: ${critical})`,
          }
        }
      }

      if (warning !== undefined) {
        const fieldUnit = fieldDef.unit
        const isHighValueField = fieldUnit === 'percent' || fieldUnit === 'ratio'
        const isBelowWarning = currentValue < warning
        const isAboveWarning = currentValue > warning
        if ((isHighValueField && isAboveWarning) || (!isHighValueField && isBelowWarning)) {
          return {
            fieldName: fieldDef.fieldName,
            displayName: fieldDef.displayName,
            method: 'threshold',
            currentValue,
            threshold: warning,
            severity: 'medium',
            message: `${fieldDef.displayName} 경고 임계값 도달 (현재: ${currentValue}, 기준: ${warning})`,
          }
        }
      }

      return null
    }

    case 'plateau': {
      // Detect if values have not changed significantly for N periods
      if (history.length < 5) return null
      const recent = history.slice(-5)
      const recentStdDev = (() => {
        const m = recent.reduce((s, v) => s + v, 0) / recent.length
        return Math.sqrt(recent.reduce((s, v) => s + Math.pow(v - m, 2), 0) / recent.length)
      })()
      // Plateau: stdDev < 1% of mean (essentially flat)
      const relativeVariance = mean > 0 ? recentStdDev / mean : recentStdDev
      if (relativeVariance > 0.01) return null
      return {
        fieldName: fieldDef.fieldName,
        displayName: fieldDef.displayName,
        method: 'plateau',
        currentValue,
        severity: 'medium',
        message: `${fieldDef.displayName} 정체 감지 — 최근 5주기 동안 변화 없음 (${currentValue})`,
      }
    }

    case 'rate-of-change': {
      if (history.length < 2) return null
      const prev = history[history.length - 2]
      if (prev === 0) return null
      const changeRate = Math.abs((currentValue - prev) / prev)
      const z = calculateZScore(changeRate, mean, stdDev)
      const zThreshold = anomalyConfig.zScoreThreshold ?? DEFAULT_Z_THRESHOLD
      const rocStreakKey = `${instanceId ?? '_'}:roc:${fieldDef.fieldName}`
      if (z < zThreshold) {
        resetStreak(rocStreakKey)
        return null
      }
      const rocSustained = incrementStreak(rocStreakKey, DEFAULT_SUSTAINED_COUNT)
      if (!rocSustained) return null
      return {
        fieldName: fieldDef.fieldName,
        displayName: fieldDef.displayName,
        method: 'rate-of-change',
        currentValue,
        zScore: z,
        severity: severityFromZ(z),
        message: `${fieldDef.displayName} 변화율 급등 (Z-Score: ${z.toFixed(2)})`,
      }
    }
  }
}

/**
 * Run anomaly detection across all configured metric fields.
 *
 * @param instanceId - Instance being analyzed
 * @param currentFields - Current metric values (Record<fieldName, value>)
 * @param fieldHistory - Historical values per field (Record<fieldName, number[]>)
 * @param fieldDefs - Protocol metric field definitions
 * @param anomalyConfigs - Per-field anomaly config
 */
export function detectAnomalies(
  instanceId: string,
  currentFields: Record<string, number | null>,
  fieldHistory: Record<string, number[]>,
  fieldDefs: MetricFieldDefinition[],
  anomalyConfigs: Record<string, FieldAnomalyConfig>
): DetectionResult {
  const anomalies: FieldAnomaly[] = []

  for (const fieldDef of fieldDefs) {
    const config = anomalyConfigs[fieldDef.fieldName]
    if (!config?.enabled) continue

    const currentValue = currentFields[fieldDef.fieldName]
    if (currentValue === null || currentValue === undefined) continue

    const history = fieldHistory[fieldDef.fieldName] ?? []
    const anomaly = detectFieldAnomaly(fieldDef, config, currentValue, history, instanceId)
    if (anomaly) anomalies.push(anomaly)
  }

  return {
    instanceId,
    timestamp: new Date().toISOString(),
    anomalies,
    hasAnomaly: anomalies.length > 0,
  }
}
