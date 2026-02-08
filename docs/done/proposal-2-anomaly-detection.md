# Proposal 2: Anomaly Detection Pipeline - 구현 명세서

> 버전: 1.0.0
> 작성일: 2026-02-06
> 대상 독자: Claude Opus 4.6 구현 에이전트
> 의존성: Proposal 1 (MetricsStore) 필수

---

## 1. 개요

### 1.1 목적

이 문서는 SentinAI의 **다층 이상 탐지 파이프라인(Multi-Layer Anomaly Detection Pipeline)**을 처음부터 구현하기 위한 완전한 명세서이다. 이 문서만으로 전체 기능을 구현할 수 있어야 한다.

### 1.2 아키텍처 개요

```
Layer 1: Statistical Detector        Layer 2: AI Semantic Analyzer
┌─────────────────────────┐          ┌───────────────────────────┐
│ Z-Score 기반             │          │ Claude 기반 로그+메트릭    │
│ 메트릭 이상치 탐지        │─────────▶│ 컨텍스트 분석              │
│ (로컬 연산, 저비용)       │  이상 시  │ (API 호출, 고비용)         │
└─────────────────────────┘          └─────────────┬─────────────┘
                                                    │
                                     ┌──────────────▼──────────────┐
                                     │ Layer 3: Alert Dispatcher   │
                                     │ Slack / Webhook / Dashboard │
                                     └─────────────────────────────┘
```

### 1.3 핵심 원칙

1. **비용 효율성**: Layer 1 통계 필터로 불필요한 AI 호출 70-90% 절감
2. **실시간성**: 매 메트릭 폴링 주기(1초)마다 Layer 1 탐지 수행
3. **정확성**: AI 시맨틱 분석으로 오탐(false positive) 최소화
4. **운영 편의성**: Slack/Webhook 알림으로 즉각적인 인지

### 1.4 의존관계

- **필수**: `src/lib/metrics-store.ts` (Proposal 1에서 구현)
- **필수**: `src/types/prediction.ts` (Proposal 1에서 정의한 `MetricDataPoint`)
- **제공**: Proposal 3 (RCA Engine)에서 이상 탐지 결과를 입력으로 사용

---

## 2. 타입 정의

### 2.1 파일: `src/types/anomaly.ts` (신규)

```typescript
/**
 * Anomaly Detection Pipeline Types
 * 다층 이상 탐지 시스템을 위한 타입 정의
 */

import { AISeverity } from './scaling';

// ============================================================================
// Layer 1: Statistical Anomaly Detection
// ============================================================================

/**
 * 이상 방향
 * - spike: 급격한 상승
 * - drop: 급격한 하락
 * - plateau: 장시간 변화 없음 (정체)
 */
export type AnomalyDirection = 'spike' | 'drop' | 'plateau';

/**
 * 탐지 대상 메트릭
 */
export type AnomalyMetric =
  | 'cpuUsage'
  | 'txPoolPending'
  | 'gasUsedRatio'
  | 'l2BlockHeight'
  | 'l2BlockInterval';

/**
 * Layer 1 통계 기반 이상 탐지 결과
 */
export interface AnomalyResult {
  /** 이상 여부 */
  isAnomaly: boolean;
  /** 이상이 감지된 메트릭 */
  metric: AnomalyMetric;
  /** 현재 값 */
  value: number;
  /** Z-Score (평균으로부터 표준편차 단위 거리) */
  zScore: number;
  /** 이상 방향 */
  direction: AnomalyDirection;
  /** 사람이 읽을 수 있는 설명 */
  description: string;
  /** 탐지 규칙 (어떤 규칙에 의해 탐지되었는지) */
  rule: 'z-score' | 'zero-drop' | 'plateau' | 'monotonic-increase';
}

// ============================================================================
// Layer 2: AI Semantic Analysis
// ============================================================================

/**
 * 이상 유형 분류
 */
export type AnomalyType = 'performance' | 'security' | 'consensus' | 'liveness';

/**
 * Layer 2 AI 심층 분석 결과
 */
export interface DeepAnalysisResult {
  /** AI가 판단한 심각도 */
  severity: AISeverity;
  /** 이상 유형 */
  anomalyType: AnomalyType;
  /** 연관된 메트릭/로그 패턴 */
  correlations: string[];
  /** 예상 영향도 */
  predictedImpact: string;
  /** 권장 조치 목록 */
  suggestedActions: string[];
  /** 영향받는 컴포넌트 */
  relatedComponents: string[];
  /** 분석 타임스탬프 */
  timestamp: string;
  /** AI 모델 응답의 원본 (디버깅용) */
  rawResponse?: string;
}

// ============================================================================
// Layer 3: Alert Dispatch
// ============================================================================

/**
 * 알림 채널 유형
 */
export type AlertChannel = 'slack' | 'webhook' | 'dashboard';

/**
 * 알림 설정
 */
export interface AlertConfig {
  /** Slack/Discord 웹훅 URL (선택) */
  webhookUrl?: string;
  /** 알림 임계값 설정 */
  thresholds: {
    /** 이 심각도 이상에서 알림 발송 */
    notifyOn: AISeverity[];
    /** 동일 유형 이상에 대한 알림 간격 (분) */
    cooldownMinutes: number;
  };
  /** 알림 활성화 여부 */
  enabled: boolean;
}

/**
 * 발송된 알림 기록
 */
export interface AlertRecord {
  /** 고유 ID */
  id: string;
  /** 원인이 된 이상 탐지 결과 */
  anomaly: AnomalyResult;
  /** AI 심층 분석 결과 (있는 경우) */
  analysis?: DeepAnalysisResult;
  /** 발송 시간 */
  sentAt: string;
  /** 발송 채널 */
  channel: AlertChannel;
  /** 발송 성공 여부 */
  success: boolean;
  /** 실패 시 에러 메시지 */
  error?: string;
}

// ============================================================================
// Anomaly Event (통합)
// ============================================================================

/**
 * 이상 이벤트 상태
 */
export type AnomalyEventStatus = 'active' | 'resolved' | 'acknowledged';

/**
 * 이상 이벤트 (Layer 1~3 결과 통합)
 */
export interface AnomalyEvent {
  /** 고유 ID (UUID v4) */
  id: string;
  /** 최초 탐지 시간 (Unix timestamp ms) */
  timestamp: number;
  /** Layer 1에서 탐지된 이상 목록 */
  anomalies: AnomalyResult[];
  /** Layer 2 AI 심층 분석 결과 (수행된 경우) */
  deepAnalysis?: DeepAnalysisResult;
  /** 이벤트 상태 */
  status: AnomalyEventStatus;
  /** 해결 시간 (있는 경우) */
  resolvedAt?: number;
  /** 발송된 알림 기록 */
  alerts: AlertRecord[];
}

// ============================================================================
// API Types
// ============================================================================

/**
 * GET /api/anomalies 응답
 */
export interface AnomaliesResponse {
  /** 이상 이벤트 목록 (최신순) */
  events: AnomalyEvent[];
  /** 전체 이벤트 수 */
  total: number;
  /** 현재 활성 이상 수 */
  activeCount: number;
}

/**
 * GET /api/anomalies/config 응답
 */
export interface AlertConfigResponse {
  config: AlertConfig;
  /** 최근 24시간 알림 발송 수 */
  alertsSent24h: number;
  /** 다음 알림 가능 시간 (쿨다운 중인 경우) */
  nextAlertAvailableAt?: string;
}

/**
 * POST /api/anomalies/config 요청 바디
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
 * Metrics API 확장 - anomalies 필드
 */
export interface MetricsAnomalyExtension {
  /** Layer 1 이상 탐지 결과 (실시간) */
  anomalies: AnomalyResult[];
  /** 현재 활성 이상 이벤트 ID (있는 경우) */
  activeEventId?: string;
}
```

---

## 3. 신규 파일 명세

### 3.1 `src/lib/anomaly-detector.ts` (Layer 1 - 통계 기반 탐지기)

#### 3.1.1 목적

매 메트릭 수집 시 로컬에서 실행되는 저비용 통계 기반 이상 탐지기. Z-Score와 규칙 기반 탐지를 조합하여 이상 여부를 판단한다.

#### 3.1.2 전체 코드

```typescript
/**
 * Layer 1: Statistical Anomaly Detector
 * Z-Score 및 규칙 기반 메트릭 이상 탐지
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
  const recentHistory = history.filter(p => p.timestamp >= oldestRelevant);
  if (recentHistory.length < 2) return null;

  // 모든 블록 높이가 동일한지 확인
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
  const recentHistory = history.filter(p => p.timestamp >= oldestRelevant);
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
    const durationSec = (now - recentHistory[0].timestamp) / 1000;

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
 * import { getRecent } from '@/lib/metrics-store';
 *
 * const current: MetricDataPoint = { ... };
 * const history = getRecent(30); // 최근 30분
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
  const blockPlateau = detectBlockPlateau(current.l2BlockHeight, history);
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
    current.l2BlockInterval,
    history.map(p => p.l2BlockInterval)
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
```

---

### 3.2 `src/lib/anomaly-ai-analyzer.ts` (Layer 2 - AI 시맨틱 분석기)

#### 3.2.1 목적

Layer 1에서 이상으로 판단된 경우에만 호출되는 AI 기반 심층 분석기. 이상 메트릭 + 로그를 Claude에 전달하여 컨텍스트 기반 분석을 수행한다.

#### 3.2.2 전체 코드

```typescript
/**
 * Layer 2: AI Semantic Anomaly Analyzer
 * Claude 기반 이상 컨텍스트 분석
 */

import { MetricDataPoint } from '@/types/prediction';
import { AnomalyResult, DeepAnalysisResult, AnomalyType } from '@/types/anomaly';
import { AISeverity } from '@/types/scaling';

// ============================================================================
// Configuration
// ============================================================================

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

/** AI 호출 최소 간격 (밀리초) - 1분 */
const MIN_AI_CALL_INTERVAL_MS = 60 * 1000;

/** 최근 분석 결과 캐시 TTL (밀리초) - 5분 */
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;

// ============================================================================
// In-Memory State
// ============================================================================

/** 마지막 AI 호출 시간 */
let lastAICallTime = 0;

/** 최근 분석 결과 캐시 */
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
 * 이상 목록의 해시 생성 (캐시 키용)
 */
function hashAnomalies(anomalies: AnomalyResult[]): string {
  const sorted = anomalies
    .map(a => `${a.metric}:${a.rule}:${a.direction}`)
    .sort()
    .join('|');
  return sorted;
}

/**
 * 이상 목록을 AI 프롬프트용 텍스트로 변환
 */
function formatAnomaliesForPrompt(anomalies: AnomalyResult[]): string {
  return anomalies
    .map((a, i) => `${i + 1}. [${a.metric}] ${a.description} (rule: ${a.rule}, z-score: ${a.zScore.toFixed(2)})`)
    .join('\n');
}

/**
 * 메트릭을 AI 프롬프트용 텍스트로 변환
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
 * 로그를 AI 프롬프트용 텍스트로 변환
 */
function formatLogsForPrompt(logs: Record<string, string>): string {
  let result = '';
  for (const [component, log] of Object.entries(logs)) {
    // 로그가 너무 길면 마지막 1000자만
    const truncatedLog = log.length > 1000 ? '...' + log.slice(-1000) : log;
    result += `\n[${component}]\n${truncatedLog}\n`;
  }
  return result;
}

/**
 * AI 응답 파싱
 */
function parseAIResponse(content: string): DeepAnalysisResult {
  // Markdown 코드 블록 제거
  const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();

  try {
    const parsed = JSON.parse(jsonStr);

    // 필수 필드 검증 및 기본값
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
    // JSON 파싱 실패 시 기본 응답
    return {
      severity: 'medium',
      anomalyType: 'performance',
      correlations: [],
      predictedImpact: 'AI 응답 파싱 실패. 원본: ' + content.substring(0, 200),
      suggestedActions: ['수동으로 로그 확인 필요'],
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
 * 탐지된 이상에 대한 AI 심층 분석 수행
 *
 * @param anomalies Layer 1에서 탐지된 이상 목록
 * @param metrics 현재 메트릭 데이터
 * @param logs 컴포넌트별 로그 (op-geth, op-node 등)
 * @returns AI 심층 분석 결과
 *
 * @remarks
 * - 최소 1분 간격으로만 AI 호출 (rate limiting)
 * - 동일한 이상 패턴은 5분간 캐시된 결과 반환
 * - AI Gateway 호출 실패 시 기본 응답 반환
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

  // 1. 캐시 확인: 동일 이상 패턴이면 캐시된 결과 반환
  const anomalyHash = hashAnomalies(anomalies);
  if (analysisCache &&
      analysisCache.anomalyHash === anomalyHash &&
      now - analysisCache.timestamp < ANALYSIS_CACHE_TTL_MS) {
    console.log('[AnomalyAIAnalyzer] Returning cached analysis');
    return analysisCache.result;
  }

  // 2. Rate limiting: 최소 간격 미달 시 캐시된 결과 반환 또는 기본 응답
  if (now - lastAICallTime < MIN_AI_CALL_INTERVAL_MS) {
    console.log('[AnomalyAIAnalyzer] Rate limited, returning cached or default');
    if (analysisCache) {
      return analysisCache.result;
    }
    return {
      severity: 'medium',
      anomalyType: 'performance',
      correlations: [],
      predictedImpact: 'Rate limited - 분석 대기 중',
      suggestedActions: ['잠시 후 다시 시도'],
      relatedComponents: [],
      timestamp: new Date().toISOString(),
    };
  }

  // 3. User 프롬프트 구성
  const userPrompt = `## Detected Anomalies
${formatAnomaliesForPrompt(anomalies)}

## Current Metrics
${formatMetricsForPrompt(metrics)}

## Recent Component Logs
${formatLogsForPrompt(logs)}

Analyze these anomalies and provide your assessment.`;

  // 4. AI Gateway 호출
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

    // 5. 캐시 업데이트
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

    // 실패 시 기본 응답
    return {
      severity: 'medium',
      anomalyType: 'performance',
      correlations: anomalies.map(a => a.description),
      predictedImpact: `AI 분석 실패: ${errorMessage}`,
      suggestedActions: ['수동으로 로그 및 메트릭 확인 필요', 'AI Gateway 연결 상태 확인'],
      relatedComponents: [],
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 분석 캐시 초기화 (테스트용)
 */
export function clearAnalysisCache(): void {
  analysisCache = null;
  lastAICallTime = 0;
}

/**
 * 현재 rate limit 상태 조회
 */
export function getRateLimitStatus(): { canCall: boolean; nextAvailableAt: number } {
  const now = Date.now();
  const canCall = now - lastAICallTime >= MIN_AI_CALL_INTERVAL_MS;
  const nextAvailableAt = lastAICallTime + MIN_AI_CALL_INTERVAL_MS;
  return { canCall, nextAvailableAt };
}
```

---

### 3.3 `src/lib/alert-dispatcher.ts` (Layer 3 - 알림 발송기)

#### 3.3.1 목적

이상 분석 결과를 Slack/Webhook으로 발송하고, 쿨다운 및 중복 알림 방지를 관리한다.

#### 3.3.2 전체 코드

```typescript
/**
 * Layer 3: Alert Dispatcher
 * Slack/Webhook 알림 발송 및 쿨다운 관리
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

/** 현재 알림 설정 */
let currentConfig: AlertConfig = { ...DEFAULT_ALERT_CONFIG };

/** 알림 발송 기록 (최근 24시간) */
let alertHistory: AlertRecord[] = [];

/** 이상 유형별 마지막 알림 시간 */
const lastAlertByType: Map<string, number> = new Map();

// ============================================================================
// Slack Message Formatting
// ============================================================================

/**
 * Slack Block Kit 형식의 메시지 생성
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
 * UUID v4 생성 (간단 구현)
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 쿨다운 체크
 */
function isInCooldown(anomalyType: string): boolean {
  const lastAlert = lastAlertByType.get(anomalyType);
  if (!lastAlert) return false;

  const cooldownMs = currentConfig.thresholds.cooldownMinutes * 60 * 1000;
  return Date.now() - lastAlert < cooldownMs;
}

/**
 * 심각도가 알림 대상인지 확인
 */
function shouldNotifyForSeverity(severity: AISeverity): boolean {
  return currentConfig.thresholds.notifyOn.includes(severity);
}

/**
 * 오래된 알림 기록 정리 (24시간 이상 된 것)
 */
function cleanupOldAlerts(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  alertHistory = alertHistory.filter(a => new Date(a.sentAt).getTime() > cutoff);
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * 알림 발송
 *
 * @param analysis AI 심층 분석 결과
 * @param metrics 현재 메트릭
 * @param anomalies 탐지된 이상 목록
 * @returns 발송된 알림 기록 (발송하지 않은 경우 null)
 *
 * @remarks
 * - 설정이 비활성화되어 있으면 발송하지 않음
 * - 심각도가 notifyOn에 포함되지 않으면 발송하지 않음
 * - 동일 유형 이상에 대해 쿨다운 시간 내 재발송하지 않음
 * - webhookUrl이 없으면 dashboard 채널로만 기록
 */
export async function dispatchAlert(
  analysis: DeepAnalysisResult,
  metrics: MetricDataPoint,
  anomalies: AnomalyResult[]
): Promise<AlertRecord | null> {
  cleanupOldAlerts();

  // 1. 활성화 체크
  if (!currentConfig.enabled) {
    console.log('[AlertDispatcher] Alerts disabled, skipping');
    return null;
  }

  // 2. 심각도 체크
  if (!shouldNotifyForSeverity(analysis.severity)) {
    console.log(`[AlertDispatcher] Severity ${analysis.severity} not in notify list, skipping`);
    return null;
  }

  // 3. 쿨다운 체크
  if (isInCooldown(analysis.anomalyType)) {
    console.log(`[AlertDispatcher] Anomaly type ${analysis.anomalyType} in cooldown, skipping`);
    return null;
  }

  // 4. 알림 레코드 생성
  const record: AlertRecord = {
    id: generateUUID(),
    anomaly: anomalies[0], // 대표 이상
    analysis,
    sentAt: new Date().toISOString(),
    channel: currentConfig.webhookUrl ? 'slack' : 'dashboard',
    success: false,
  };

  // 5. Webhook 발송 (URL이 있는 경우)
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
    // Dashboard 전용 알림
    record.success = true;
    console.log(`[AlertDispatcher] Dashboard alert recorded: ${analysis.severity} ${analysis.anomalyType}`);
  }

  // 6. 상태 업데이트
  lastAlertByType.set(analysis.anomalyType, Date.now());
  alertHistory.push(record);

  return record;
}

// ============================================================================
// Configuration Management
// ============================================================================

/**
 * 현재 알림 설정 조회
 */
export function getAlertConfig(): AlertConfig {
  return { ...currentConfig };
}

/**
 * 알림 설정 업데이트
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
 * 최근 24시간 알림 기록 조회
 */
export function getAlertHistory(): AlertRecord[] {
  cleanupOldAlerts();
  return [...alertHistory];
}

/**
 * 다음 알림 가능 시간 조회 (쿨다운 중인 경우)
 */
export function getNextAlertAvailableAt(anomalyType: string): number | null {
  const lastAlert = lastAlertByType.get(anomalyType);
  if (!lastAlert) return null;

  const cooldownMs = currentConfig.thresholds.cooldownMinutes * 60 * 1000;
  const nextAvailable = lastAlert + cooldownMs;

  return Date.now() < nextAvailable ? nextAvailable : null;
}

/**
 * 알림 기록 초기화 (테스트용)
 */
export function clearAlertHistory(): void {
  alertHistory = [];
  lastAlertByType.clear();
}
```

---

### 3.4 `src/lib/anomaly-event-store.ts` (이상 이벤트 저장소)

#### 3.4.1 목적

탐지된 이상 이벤트를 메모리에 저장하고 관리한다. API에서 조회 및 상태 업데이트에 사용된다.

#### 3.4.2 전체 코드

```typescript
/**
 * Anomaly Event Store
 * 탐지된 이상 이벤트 메모리 저장소
 */

import { AnomalyEvent, AnomalyResult, DeepAnalysisResult, AlertRecord, AnomalyEventStatus } from '@/types/anomaly';

// ============================================================================
// Configuration
// ============================================================================

/** 최대 이벤트 저장 수 */
const MAX_EVENTS = 100;

/** 이벤트 자동 해결 시간 (밀리초) - 30분간 새로운 이상 없으면 해결 처리 */
const AUTO_RESOLVE_MS = 30 * 60 * 1000;

// ============================================================================
// In-Memory State
// ============================================================================

/** 이벤트 저장소 (최신순) */
let events: AnomalyEvent[] = [];

/** 현재 활성 이벤트 ID */
let activeEventId: string | null = null;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * UUID v4 생성
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 오래된 이벤트 정리
 */
function cleanup(): void {
  // 최대 개수 초과 시 오래된 것부터 제거
  if (events.length > MAX_EVENTS) {
    events = events.slice(0, MAX_EVENTS);
  }

  // 자동 해결 처리
  const now = Date.now();
  for (const event of events) {
    if (event.status === 'active' && now - event.timestamp > AUTO_RESOLVE_MS) {
      event.status = 'resolved';
      event.resolvedAt = now;
    }
  }

  // 활성 이벤트 ID 업데이트
  const activeEvent = events.find(e => e.status === 'active');
  activeEventId = activeEvent?.id || null;
}

// ============================================================================
// Main Exports
// ============================================================================

/**
 * 새 이상 이벤트 생성 또는 기존 활성 이벤트에 추가
 *
 * @param anomalies Layer 1에서 탐지된 이상 목록
 * @returns 생성/업데이트된 이벤트
 */
export function createOrUpdateEvent(anomalies: AnomalyResult[]): AnomalyEvent {
  cleanup();
  const now = Date.now();

  // 활성 이벤트가 있으면 이상 목록 업데이트
  if (activeEventId) {
    const activeEvent = events.find(e => e.id === activeEventId);
    if (activeEvent) {
      // 기존 이상에 없는 새로운 메트릭의 이상만 추가
      const existingMetrics = new Set(activeEvent.anomalies.map(a => a.metric));
      const newAnomalies = anomalies.filter(a => !existingMetrics.has(a.metric));

      if (newAnomalies.length > 0) {
        activeEvent.anomalies.push(...newAnomalies);
      }

      // 기존 이상 업데이트 (같은 메트릭이면 최신 값으로)
      for (const anomaly of anomalies) {
        const existingIndex = activeEvent.anomalies.findIndex(a => a.metric === anomaly.metric);
        if (existingIndex >= 0) {
          activeEvent.anomalies[existingIndex] = anomaly;
        }
      }

      return activeEvent;
    }
  }

  // 새 이벤트 생성
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
 * 이벤트에 AI 분석 결과 추가
 */
export function addDeepAnalysis(eventId: string, analysis: DeepAnalysisResult): void {
  const event = events.find(e => e.id === eventId);
  if (event) {
    event.deepAnalysis = analysis;
  }
}

/**
 * 이벤트에 알림 기록 추가
 */
export function addAlertRecord(eventId: string, alert: AlertRecord): void {
  const event = events.find(e => e.id === eventId);
  if (event) {
    event.alerts.push(alert);
  }
}

/**
 * 이벤트 상태 업데이트
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
 * 활성 이벤트 해결 처리 (이상이 더 이상 탐지되지 않을 때 호출)
 */
export function resolveActiveEventIfExists(): void {
  if (activeEventId) {
    updateEventStatus(activeEventId, 'resolved');
  }
}

/**
 * 이벤트 목록 조회 (페이지네이션)
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
 * 특정 이벤트 조회
 */
export function getEventById(eventId: string): AnomalyEvent | null {
  return events.find(e => e.id === eventId) || null;
}

/**
 * 현재 활성 이벤트 ID 조회
 */
export function getActiveEventId(): string | null {
  cleanup();
  return activeEventId;
}

/**
 * 저장소 초기화 (테스트용)
 */
export function clearEvents(): void {
  events = [];
  activeEventId = null;
}
```

---

### 3.5 `src/app/api/anomalies/route.ts` (이상 이벤트 API)

#### 3.5.1 전체 코드

```typescript
/**
 * Anomalies API
 * GET: 이상 이벤트 목록 조회
 */

import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/anomaly-event-store';
import { AnomaliesResponse } from '@/types/anomaly';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse<AnomaliesResponse>> {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  // 유효성 검증
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

### 3.6 `src/app/api/anomalies/config/route.ts` (알림 설정 API)

#### 3.6.1 전체 코드

```typescript
/**
 * Anomaly Alert Config API
 * GET: 현재 알림 설정 조회
 * POST: 알림 설정 업데이트
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

  // 최근 24시간 알림 수 계산
  const alertsSent24h = history.length;

  // 다음 알림 가능 시간 (가장 최근 알림 기준)
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

    // 유효성 검증
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

    // 설정 업데이트
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

## 4. 기존 파일 수정

### 4.1 `src/app/api/metrics/route.ts` 수정

#### 4.1.1 수정 목적

매 메트릭 수집 시 Layer 1 이상 탐지를 수행하고, 이상 발견 시 Layer 2 AI 분석을 비동기로 트리거한다.

#### 4.1.2 수정 내용

**파일 상단에 import 추가:**

```typescript
// 기존 import 아래에 추가
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

**환경 변수 체크 추가 (파일 상단):**

```typescript
// 이상 탐지 활성화 여부 (기본: 활성화)
const ANOMALY_DETECTION_ENABLED = process.env.ANOMALY_DETECTION_ENABLED !== 'false';
```

**GET 함수 내부, 응답 반환 직전에 이상 탐지 로직 추가:**

아래 코드를 `const response = NextResponse.json({...})` 직전에 삽입한다.

```typescript
        // ================================================================
        // Anomaly Detection Pipeline (Layer 1 → Layer 2 → Layer 3)
        // ================================================================
        let detectedAnomalies: AnomalyResult[] = [];
        let activeAnomalyEventId: string | undefined;

        if (ANOMALY_DETECTION_ENABLED && !isStressTest) {
          try {
            // 1. MetricsStore에 데이터 푸시
            const previousBlock = await l2RpcClient.getBlock({ blockNumber: blockNumber - 1n }).catch(() => null);
            const blockInterval = previousBlock
              ? Number(block.timestamp) - Number(previousBlock.timestamp)
              : 2; // 기본값 2초

            const dataPoint: MetricDataPoint = {
              timestamp: Date.now(),
              cpuUsage: effectiveCpu,
              txPoolPending: effectiveTx,
              gasUsedRatio: gasUsed / gasLimit,
              l2BlockHeight: Number(blockNumber),
              l2BlockInterval: blockInterval,
            };

            pushToMetricsStore(dataPoint);

            // 2. Layer 1: 통계 기반 이상 탐지
            const history = getRecent(30); // 최근 30분
            detectedAnomalies = detectAnomalies(dataPoint, history);

            if (detectedAnomalies.length > 0) {
              console.log(`[Anomaly] Detected ${detectedAnomalies.length} anomalies`);

              // 3. 이벤트 저장소에 기록
              const event = createOrUpdateEvent(detectedAnomalies);
              activeAnomalyEventId = event.id;

              // 4. Layer 2: AI 심층 분석 (비동기, 응답 블로킹 안 함)
              // 첫 번째 이상 또는 심층 분석이 아직 없는 경우에만 트리거
              if (!event.deepAnalysis) {
                (async () => {
                  try {
                    const logs = await getAllLiveLogs();
                    const analysis = await analyzeAnomalies(detectedAnomalies, dataPoint, logs);
                    addDeepAnalysis(event.id, analysis);

                    // 5. Layer 3: 알림 발송
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
              // 이상이 없으면 활성 이벤트 해결 처리
              resolveActiveEventIfExists();
              activeAnomalyEventId = getActiveEventId() || undefined;
            }
          } catch (anomalyError) {
            console.error('[Anomaly] Detection pipeline error:', anomalyError);
          }
        }
```

**응답 객체에 anomalies 필드 추가:**

기존 응답 JSON에 다음 필드를 추가한다.

```typescript
        const response = NextResponse.json({
            timestamp: new Date().toISOString(),
            metrics: {
                // ... 기존 필드 유지 ...
            },
            components,
            cost: {
                // ... 기존 필드 유지 ...
            },
            status: "healthy",
            stressMode: isStressTest,
            // === 신규 필드 추가 ===
            anomalies: detectedAnomalies,
            activeAnomalyEventId,
        });
```

---

### 4.2 `src/app/page.tsx` 수정

#### 4.2.1 수정 목적

- 활성 이상 이벤트가 있을 때 상단에 알림 배너 표시
- AI Monitor 섹션에 이상 탐지 피드 추가

#### 4.2.2 인터페이스 확장

**MetricData 인터페이스에 필드 추가:**

```typescript
interface MetricData {
  // ... 기존 필드 유지 ...
  anomalies?: AnomalyResult[];
  activeAnomalyEventId?: string;
}
```

**AnomalyResult 타입 import (또는 로컬 정의):**

```typescript
// 파일 상단에 추가
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

#### 4.2.3 상태 추가

```typescript
// 기존 상태 아래에 추가
const [activeAnomalies, setActiveAnomalies] = useState<AnomalyResult[]>([]);
```

#### 4.2.4 fetchData 함수 수정

```typescript
        // 기존 setCurrent(data) 아래에 추가
        if (data.anomalies && data.anomalies.length > 0) {
          setActiveAnomalies(data.anomalies);
        } else {
          setActiveAnomalies([]);
        }
```

#### 4.2.5 이상 알림 배너 컴포넌트 추가 (header 바로 아래)

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

#### 4.2.6 AI Monitor 섹션 내 이상 피드 추가

AI Monitor 영역의 Log Stream 부분에 이상 탐지 피드를 추가한다.

```typescript
            {/* 1. Log Stream (Left) */}
            <div className="flex-1 bg-[#0D1117] p-6 overflow-y-auto font-mono text-sm custom-scrollbar relative">
              <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-[#0D1117] to-transparent pointer-events-none"></div>

              <div className="space-y-4">

                {/* === Anomaly Detection Feed (신규 추가) === */}
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

                {/* ... 기존 Stress Logs, Analyzing State, AI Result 등 유지 ... */}
```

---

## 5. API 명세

### 5.1 GET /api/anomalies

**설명**: 이상 이벤트 목록 조회

**요청 파라미터:**
| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| limit | number | 20 | 반환할 이벤트 수 (1-100) |
| offset | number | 0 | 건너뛸 이벤트 수 |

**응답 예시:**
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
          "description": "CPU 사용률 0%로 급락: 이전 평균 45.2% → 현재 0.5%. 프로세스 크래시 의심.",
          "rule": "zero-drop"
        }
      ],
      "deepAnalysis": {
        "severity": "critical",
        "anomalyType": "liveness",
        "correlations": ["CPU crash detected", "Process termination suspected"],
        "predictedImpact": "L2 노드 완전 중단, 트랜잭션 처리 불가",
        "suggestedActions": ["op-geth 프로세스 상태 확인", "kubectl logs 확인", "노드 재시작 고려"],
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

**설명**: 현재 알림 설정 조회

**응답 예시:**
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

**설명**: 알림 설정 업데이트

**요청 바디:**
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

**응답**: GET /api/anomalies/config과 동일한 형식

### 5.4 GET /api/metrics (확장)

**기존 응답에 추가된 필드:**

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
      "description": "TxPool 300초간 단조 증가: 200 → 1500 (+1300). Batcher 장애 의심.",
      "rule": "monotonic-increase"
    }
  ],
  "activeAnomalyEventId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## 6. AI 프롬프트 전문

### 6.1 Layer 2 System Prompt (전문)

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
1. [cpuUsage] CPU 사용률 0%로 급락: 이전 평균 45.2% → 현재 0.5%. 프로세스 크래시 의심. (rule: zero-drop, z-score: -8.50)
2. [txPoolPending] TxPool 300초간 단조 증가: 200 → 1500 (+1300). Batcher 장애 의심. (rule: monotonic-increase, z-score: 0.00)

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

## 7. 환경 변수

### 7.1 신규 환경 변수

`.env.local`에 다음을 추가한다:

```bash
# ========================================
# Anomaly Detection Configuration
# ========================================

# 이상 탐지 활성화 여부 (기본: true)
# 'false'로 설정 시 이상 탐지 파이프라인 비활성화
ANOMALY_DETECTION_ENABLED=true

# Slack/Discord 웹훅 URL (선택사항)
# 설정 시 high/critical 이상에 대해 알림 발송
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### 7.2 기존 환경 변수 (참조)

이미 정의되어 있어야 하는 환경 변수:

```bash
# AI Gateway (필수)
AI_GATEWAY_URL=https://api.ai.tokamak.network
ANTHROPIC_API_KEY=your-api-key

# K8s (로그 수집용)
K8S_NAMESPACE=default
K8S_APP_PREFIX=op
```

---

## 8. 테스트 검증

### 8.1 curl 테스트 명령어

**이상 이벤트 목록 조회:**
```bash
curl -s http://localhost:3002/api/anomalies | jq
```

**이상 이벤트 페이지네이션:**
```bash
curl -s "http://localhost:3002/api/anomalies?limit=5&offset=0" | jq
```

**알림 설정 조회:**
```bash
curl -s http://localhost:3002/api/anomalies/config | jq
```

**알림 설정 업데이트:**
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

**메트릭 API에서 이상 필드 확인:**
```bash
curl -s http://localhost:3002/api/metrics | jq '.anomalies, .activeAnomalyEventId'
```

### 8.2 UI 테스트 시나리오

**시나리오 1: 정상 상태**
1. 대시보드 접속
2. 이상 알림 배너가 표시되지 않음
3. AI Monitor의 "Real-time Anomalies" 섹션이 없음

**시나리오 2: 이상 탐지**
1. 메트릭에서 이상이 탐지됨 (예: TxPool 급증)
2. 상단에 빨간색 이상 알림 배너 표시
3. AI Monitor에 "Real-time Anomalies" 섹션 표시
4. "Analyze Now" 버튼 클릭 시 AI 분석 트리거

**시나리오 3: 이상 해결**
1. 이상 원인이 해결됨
2. 30분 후 또는 다음 메트릭 수집 시 이상 배너 사라짐
3. /api/anomalies에서 해당 이벤트 status가 "resolved"로 변경

### 8.3 엣지 케이스

**빈 히스토리:**
- MetricsStore에 데이터가 5개 미만일 때
- 이상 탐지 스킵, 빈 배열 반환

**모든 메트릭 정상:**
- Z-Score가 임계값 미만
- 규칙 기반 탐지도 해당 없음
- 빈 배열 반환, 활성 이벤트 해결 처리

**연속 이상 탐지:**
- 첫 번째 이상 → 새 이벤트 생성, AI 분석 트리거
- 두 번째 이상 (1초 후) → 기존 이벤트에 추가, AI 분석 재트리거 안 함 (rate limit)
- AI 분석 완료 → 알림 발송 (쿨다운 시작)
- 세 번째 이상 (5분 후) → 기존 이벤트에 추가, 알림 쿨다운으로 재발송 안 함

---

## 9. 의존관계 및 구현 순서

### 9.1 전제 조건

이 Proposal을 구현하기 전에 **Proposal 1 (MetricsStore)**이 먼저 구현되어 있어야 한다:

- `src/lib/metrics-store.ts` - `push()`, `getRecent()` 함수
- `src/types/prediction.ts` - `MetricDataPoint` 타입

### 9.2 구현 순서

| 단계 | 파일 | 설명 |
|------|------|------|
| 1 | `src/types/anomaly.ts` | 타입 정의 |
| 2 | `src/lib/anomaly-detector.ts` | Layer 1 통계 탐지기 |
| 3 | `src/lib/anomaly-ai-analyzer.ts` | Layer 2 AI 분석기 |
| 4 | `src/lib/alert-dispatcher.ts` | Layer 3 알림 발송기 |
| 5 | `src/lib/anomaly-event-store.ts` | 이벤트 저장소 |
| 6 | `src/app/api/anomalies/route.ts` | 이벤트 API |
| 7 | `src/app/api/anomalies/config/route.ts` | 설정 API |
| 8 | `src/app/api/metrics/route.ts` | 메트릭 API 수정 |
| 9 | `src/app/page.tsx` | 프론트엔드 수정 |

### 9.3 후속 Proposal과의 연동

**Proposal 3 (RCA Engine)에서 활용:**
- `AnomalyEvent`의 `deepAnalysis` 결과를 RCA Engine의 입력으로 사용
- 심각한 이상(critical) 탐지 시 자동으로 RCA 트리거 가능

---

## 10. 파일 구조 요약

```
src/
├── types/
│   ├── scaling.ts        # 기존 (AISeverity 등)
│   ├── prediction.ts     # Proposal 1에서 추가 (MetricDataPoint)
│   └── anomaly.ts        # ★ 신규
├── lib/
│   ├── ai-analyzer.ts        # 기존 (로그 분석)
│   ├── log-ingester.ts       # 기존 (로그 수집)
│   ├── metrics-store.ts      # Proposal 1에서 추가
│   ├── anomaly-detector.ts   # ★ 신규 (Layer 1)
│   ├── anomaly-ai-analyzer.ts # ★ 신규 (Layer 2)
│   ├── alert-dispatcher.ts   # ★ 신규 (Layer 3)
│   └── anomaly-event-store.ts # ★ 신규
└── app/
    ├── api/
    │   ├── metrics/route.ts     # ★ 수정
    │   └── anomalies/
    │       ├── route.ts         # ★ 신규
    │       └── config/route.ts  # ★ 신규
    └── page.tsx                 # ★ 수정
```

---

## 11. 체크리스트

구현 완료 후 다음 항목을 확인한다:

- [ ] `npm run lint` 오류 없음
- [ ] `npm run build` 성공
- [ ] GET /api/anomalies 정상 응답
- [ ] GET /api/anomalies/config 정상 응답
- [ ] POST /api/anomalies/config 설정 업데이트 동작
- [ ] GET /api/metrics에 `anomalies` 필드 포함
- [ ] 정상 상태에서 이상 배너 미표시
- [ ] 이상 시뮬레이션 시 배너 표시
- [ ] AI 분석 트리거 및 결과 표시
- [ ] Slack 웹훅 알림 발송 (설정 시)
- [ ] 쿨다운 동작 확인

---

**문서 끝**
