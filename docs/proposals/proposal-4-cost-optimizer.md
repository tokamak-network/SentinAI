# Proposal 4: AI Cost Optimizer - 구현 명세서

> 작성일: 2026-02-06
> 대상 독자: Claude Opus 4.6 구현 에이전트
> 목표: 이 문서만으로 기능을 처음부터 끝까지 구현 가능하도록 함

---

## 목차

1. [개요](#1-개요)
2. [타입 정의](#2-타입-정의)
3. [신규 파일 명세](#3-신규-파일-명세)
4. [기존 파일 수정](#4-기존-파일-수정)
5. [API 명세](#5-api-명세)
6. [AI 프롬프트 전문](#6-ai-프롬프트-전문)
7. [환경 변수](#7-환경-변수)
8. [테스트 검증](#8-테스트-검증)
9. [의존관계](#9-의존관계)
10. [UI 상세 - Usage Heatmap](#10-ui-상세---usage-heatmap)

---

## 1. 개요

### 1.1 기능 설명

**AI Cost Optimizer**는 Optimism L2 노드의 vCPU 사용 패턴을 분석하여 비용 절감 기회를 자동으로 식별하고, AI 기반 추천을 제공하는 기능이다.

**핵심 기능:**
- 시간대별 vCPU 사용 패턴 추적 (7일간)
- 요일 x 시간 히트맵으로 사용 패턴 시각화
- Claude AI를 통한 비용 최적화 추천 생성
- 예상 절감액 및 구현 방법 제시

### 1.2 현재 시스템 한계

현재 `src/app/api/metrics/route.ts`의 비용 계산은 정적 공식 기반이다:

```typescript
// 현재 방식: 고정된 평균 사용 패턴 가정
const avgVcpu = 0.7 * 1 + 0.2 * 2 + 0.1 * 4; // 1.5 vCPU Average
const dynamicMonthlyCost = (avgVcpu * FARGATE_VCPU_HOUR + avgMemory * FARGATE_MEM_GB_HOUR) * HOURS_PER_MONTH;
```

**문제점:**
- 실제 시간대별 패턴 분석 없음 (새벽에도 동일 리소스 할당)
- Reserved vs On-Demand 비교 없음
- 스케일링 이력 기반 최적화 없음
- 실제 비용 vs 최적 비용 갭 분석 없음

### 1.3 의존관계

| 의존 대상 | 설명 | 상태 |
|-----------|------|------|
| MetricsStore (P1) | 시계열 메트릭 저장소. `getStats()` 함수 활용 | Proposal 1에서 구현 필요 |
| ScalingHistory | 스케일링 이력 조회. `getScalingHistory()` 함수 | 기존 `k8s-scaler.ts`에 존재 |
| AI Gateway | Claude API 호출 | 기존 패턴 존재 (`ai-analyzer.ts`) |

**독립적:** Proposal 2, 3, 5와 독립적으로 구현 가능

---

## 2. 타입 정의

### 2.1 파일 생성: `src/types/cost.ts`

```typescript
/**
 * AI Cost Optimizer Types
 * vCPU 사용 패턴 분석 및 비용 최적화 추천을 위한 타입 정의
 */

/**
 * 시간대별 사용 패턴
 * 7일 x 24시간 매트릭스의 각 셀에 대한 통계
 */
export interface UsagePattern {
  /** 시간 (0-23) */
  hourOfDay: number;
  /** 요일 (0=일요일, 1=월요일, ..., 6=토요일) */
  dayOfWeek: number;
  /** 해당 시간대의 평균 vCPU */
  avgVcpu: number;
  /** 해당 시간대의 최대 vCPU */
  peakVcpu: number;
  /** 해당 시간대의 평균 CPU 사용률 (0-100) */
  avgUtilization: number;
  /** 해당 시간대에 수집된 샘플 수 */
  sampleCount: number;
}

/**
 * 비용 최적화 추천 항목
 */
export interface CostRecommendation {
  /** 추천 유형 */
  type: 'downscale' | 'schedule' | 'reserved' | 'right-size';
  /** 추천 제목 (한글) */
  title: string;
  /** 상세 설명 (한글) */
  description: string;
  /** 현재 월간 비용 (USD) */
  currentCost: number;
  /** 적용 후 예상 월간 비용 (USD) */
  projectedCost: number;
  /** 절감률 (0-100) */
  savingsPercent: number;
  /** AI 추천 신뢰도 (0-1) */
  confidence: number;
  /** 구현 방법 설명 (한글) */
  implementation: string;
  /** 위험도 */
  risk: 'low' | 'medium' | 'high';
}

/**
 * 비용 분석 리포트
 */
export interface CostReport {
  /** 리포트 고유 ID (UUID) */
  id: string;
  /** 생성 시각 (ISO 8601) */
  generatedAt: string;
  /** 현재 예상 월간 비용 (USD) */
  currentMonthly: number;
  /** 최적화 후 예상 월간 비용 (USD) */
  optimizedMonthly: number;
  /** 총 절감률 (0-100) */
  totalSavingsPercent: number;
  /** 추천 목록 */
  recommendations: CostRecommendation[];
  /** 시간대별 사용 패턴 (7x24=168개) */
  usagePatterns: UsagePattern[];
  /** AI가 생성한 자연어 인사이트 (한글) */
  aiInsight: string;
  /** 분석 기간 (일) */
  periodDays: number;
}

/**
 * 사용량 데이터 포인트 (내부 저장용)
 */
export interface UsageDataPoint {
  /** Unix timestamp (ms) */
  timestamp: number;
  /** 할당된 vCPU */
  vcpu: number;
  /** CPU 사용률 (0-100) */
  cpuUtilization: number;
}

/**
 * 24시간 프로파일 (시간대별 요약)
 */
export interface HourlyProfile {
  /** 시간 (0-23) */
  hour: number;
  /** 평균 vCPU */
  avgVcpu: number;
  /** 평균 CPU 사용률 */
  avgUtilization: number;
}

/**
 * 비용 계산 상수
 */
export const FARGATE_PRICING = {
  /** vCPU 시간당 비용 (USD) - 서울 리전 */
  vcpuPerHour: 0.04656,
  /** 메모리 GB 시간당 비용 (USD) - 서울 리전 */
  memGbPerHour: 0.00511,
  /** 리전 */
  region: 'ap-northeast-2' as const,
} as const;

/**
 * 시간 상수
 */
export const TIME_CONSTANTS = {
  /** 월간 시간 */
  HOURS_PER_MONTH: 730,
  /** 일간 시간 */
  HOURS_PER_DAY: 24,
  /** 주간 일수 */
  DAYS_PER_WEEK: 7,
  /** 분당 밀리초 */
  MS_PER_MINUTE: 60 * 1000,
  /** 일당 밀리초 */
  MS_PER_DAY: 24 * 60 * 60 * 1000,
} as const;

/**
 * 추천 유형별 레이블 (UI 표시용)
 */
export const RECOMMENDATION_TYPE_LABELS: Record<CostRecommendation['type'], string> = {
  downscale: '리소스 축소',
  schedule: '시간 기반 스케줄링',
  reserved: '예약 인스턴스',
  'right-size': '적정 사이징',
} as const;

/**
 * 위험도별 스타일 (UI 표시용)
 */
export const RISK_STYLES: Record<CostRecommendation['risk'], { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-green-100', text: 'text-green-700', label: '낮음' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '중간' },
  high: { bg: 'bg-red-100', text: 'text-red-700', label: '높음' },
} as const;
```

---

## 3. 신규 파일 명세

### 3.1 파일 생성: `src/lib/usage-tracker.ts`

vCPU 사용 패턴을 추적하고 분석하는 모듈.

```typescript
/**
 * Usage Tracker Module
 * vCPU 사용 패턴을 추적하여 비용 최적화 분석에 활용
 */

import {
  UsageDataPoint,
  UsagePattern,
  HourlyProfile,
  TIME_CONSTANTS,
} from '@/types/cost';

// ============================================================
// In-Memory Storage
// ============================================================

/**
 * 사용량 데이터 저장소
 * - 최대 7일간 데이터 보관
 * - 1분 간격 수집 시 최대 10,080개 (7 * 24 * 60)
 */
const MAX_DATA_POINTS = 10080;
let usageData: UsageDataPoint[] = [];

/**
 * 환경 변수로 추적 활성화 여부 결정
 */
function isTrackingEnabled(): boolean {
  return process.env.COST_TRACKING_ENABLED !== 'false';
}

// ============================================================
// Data Collection
// ============================================================

/**
 * 사용량 데이터 기록
 *
 * @param vcpu - 현재 할당된 vCPU (1, 2, 4, 8 등)
 * @param cpuUtilization - 현재 CPU 사용률 (0-100)
 *
 * @example
 * ```typescript
 * // metrics API에서 호출
 * recordUsage(currentVcpu, effectiveCpu);
 * ```
 */
export function recordUsage(vcpu: number, cpuUtilization: number): void {
  if (!isTrackingEnabled()) {
    return;
  }

  // 스트레스 테스트 모드의 시뮬레이션 데이터는 제외 (vcpu가 8인 경우)
  // 실제 운영에서는 8 vCPU도 가능하므로, 필요시 이 조건 수정
  if (vcpu === 8) {
    return;
  }

  const dataPoint: UsageDataPoint = {
    timestamp: Date.now(),
    vcpu,
    cpuUtilization: Math.min(Math.max(cpuUtilization, 0), 100), // 0-100 범위로 클램프
  };

  usageData.push(dataPoint);

  // 최대 크기 초과 시 오래된 데이터 제거
  if (usageData.length > MAX_DATA_POINTS) {
    usageData = usageData.slice(-MAX_DATA_POINTS);
  }
}

/**
 * 지정된 기간의 사용량 데이터 조회
 *
 * @param days - 조회할 기간 (일)
 * @returns 해당 기간의 UsageDataPoint 배열
 */
export function getUsageData(days: number): UsageDataPoint[] {
  const cutoff = Date.now() - days * TIME_CONSTANTS.MS_PER_DAY;
  return usageData.filter((point) => point.timestamp >= cutoff);
}

/**
 * 전체 사용량 데이터 개수 조회 (디버깅용)
 */
export function getUsageDataCount(): number {
  return usageData.length;
}

/**
 * 사용량 데이터 초기화 (테스트용)
 */
export function clearUsageData(): void {
  usageData = [];
}

// ============================================================
// Pattern Analysis
// ============================================================

/**
 * 시간대별 사용 패턴 분석
 *
 * 7일 x 24시간 = 168개의 버킷으로 그룹화하여 통계 계산
 *
 * @param days - 분석할 기간 (일), 기본값 7
 * @returns UsagePattern 배열 (최대 168개)
 *
 * @example
 * ```typescript
 * const patterns = analyzePatterns(7);
 * // 월요일 오전 10시 패턴
 * const mondayMorning = patterns.find(p => p.dayOfWeek === 1 && p.hourOfDay === 10);
 * console.log(`평균 vCPU: ${mondayMorning?.avgVcpu}`);
 * ```
 */
export function analyzePatterns(days: number = 7): UsagePattern[] {
  const data = getUsageData(days);

  if (data.length === 0) {
    return [];
  }

  // 버킷 초기화: [dayOfWeek][hourOfDay] = { vcpuSum, vcpuMax, utilSum, count }
  type Bucket = {
    vcpuSum: number;
    vcpuMax: number;
    utilSum: number;
    count: number;
  };

  const buckets: Map<string, Bucket> = new Map();

  // 데이터를 버킷에 분류
  for (const point of data) {
    const date = new Date(point.timestamp);
    const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const hourOfDay = date.getHours(); // 0-23
    const key = `${dayOfWeek}-${hourOfDay}`;

    const bucket = buckets.get(key) || {
      vcpuSum: 0,
      vcpuMax: 0,
      utilSum: 0,
      count: 0,
    };

    bucket.vcpuSum += point.vcpu;
    bucket.vcpuMax = Math.max(bucket.vcpuMax, point.vcpu);
    bucket.utilSum += point.cpuUtilization;
    bucket.count += 1;

    buckets.set(key, bucket);
  }

  // 버킷을 UsagePattern으로 변환
  const patterns: UsagePattern[] = [];

  buckets.forEach((bucket, key) => {
    const [dayStr, hourStr] = key.split('-');
    const dayOfWeek = parseInt(dayStr, 10);
    const hourOfDay = parseInt(hourStr, 10);

    patterns.push({
      dayOfWeek,
      hourOfDay,
      avgVcpu: Math.round((bucket.vcpuSum / bucket.count) * 100) / 100,
      peakVcpu: bucket.vcpuMax,
      avgUtilization: Math.round((bucket.utilSum / bucket.count) * 100) / 100,
      sampleCount: bucket.count,
    });
  });

  // 정렬: 요일 → 시간 순
  patterns.sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) {
      return a.dayOfWeek - b.dayOfWeek;
    }
    return a.hourOfDay - b.hourOfDay;
  });

  return patterns;
}

/**
 * 24시간 프로파일 생성 (요일 무관)
 *
 * 모든 요일의 같은 시간대 데이터를 합쳐서 시간별 평균 계산
 *
 * @returns 24개의 HourlyProfile
 */
export function getHourlyBreakdown(): HourlyProfile[] {
  const data = getUsageData(7); // 최근 7일 데이터

  if (data.length === 0) {
    // 데이터가 없으면 기본값 반환
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      avgVcpu: 1,
      avgUtilization: 0,
    }));
  }

  // 시간별 누적
  const hourlyBuckets: Array<{ vcpuSum: number; utilSum: number; count: number }> =
    Array.from({ length: 24 }, () => ({ vcpuSum: 0, utilSum: 0, count: 0 }));

  for (const point of data) {
    const hour = new Date(point.timestamp).getHours();
    hourlyBuckets[hour].vcpuSum += point.vcpu;
    hourlyBuckets[hour].utilSum += point.cpuUtilization;
    hourlyBuckets[hour].count += 1;
  }

  return hourlyBuckets.map((bucket, hour) => ({
    hour,
    avgVcpu: bucket.count > 0
      ? Math.round((bucket.vcpuSum / bucket.count) * 100) / 100
      : 1,
    avgUtilization: bucket.count > 0
      ? Math.round((bucket.utilSum / bucket.count) * 100) / 100
      : 0,
  }));
}

/**
 * 사용 패턴 요약 통계
 *
 * @param days - 분석 기간
 * @returns 요약 통계
 */
export function getUsageSummary(days: number = 7): {
  avgVcpu: number;
  peakVcpu: number;
  avgUtilization: number;
  dataPointCount: number;
  oldestDataAge: number; // hours
} {
  const data = getUsageData(days);

  if (data.length === 0) {
    return {
      avgVcpu: 1,
      peakVcpu: 1,
      avgUtilization: 0,
      dataPointCount: 0,
      oldestDataAge: 0,
    };
  }

  let vcpuSum = 0;
  let peakVcpu = 0;
  let utilSum = 0;

  for (const point of data) {
    vcpuSum += point.vcpu;
    peakVcpu = Math.max(peakVcpu, point.vcpu);
    utilSum += point.cpuUtilization;
  }

  const oldestTimestamp = data[0].timestamp;
  const oldestDataAge = (Date.now() - oldestTimestamp) / (1000 * 60 * 60); // hours

  return {
    avgVcpu: Math.round((vcpuSum / data.length) * 100) / 100,
    peakVcpu,
    avgUtilization: Math.round((utilSum / data.length) * 100) / 100,
    dataPointCount: data.length,
    oldestDataAge: Math.round(oldestDataAge * 10) / 10,
  };
}
```

---

### 3.2 파일 생성: `src/lib/cost-optimizer.ts`

AI 기반 비용 분석 및 추천 생성 모듈.

```typescript
/**
 * AI Cost Optimizer Module
 * Claude AI를 활용한 비용 최적화 분석 및 추천 생성
 */

import {
  UsagePattern,
  CostRecommendation,
  CostReport,
  FARGATE_PRICING,
  TIME_CONSTANTS,
} from '@/types/cost';
import { ScalingHistoryEntry } from '@/types/scaling';
import { analyzePatterns, getUsageSummary } from './usage-tracker';
import { getScalingHistory } from './k8s-scaler';

// ============================================================
// AI Gateway Configuration
// ============================================================

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

// ============================================================
// Cost Calculation Utilities
// ============================================================

/**
 * 주어진 평균 vCPU로 월간 비용 계산
 *
 * @param avgVcpu - 평균 vCPU
 * @returns 월간 비용 (USD)
 */
export function calculateMonthlyCost(avgVcpu: number): number {
  const memoryGiB = avgVcpu * 2; // Memory = vCPU * 2
  const hourlyCost =
    avgVcpu * FARGATE_PRICING.vcpuPerHour +
    memoryGiB * FARGATE_PRICING.memGbPerHour;

  return Math.round(hourlyCost * TIME_CONSTANTS.HOURS_PER_MONTH * 100) / 100;
}

/**
 * 고정 4 vCPU 기준 월간 비용 (베이스라인)
 */
export function getBaselineMonthlyCost(): number {
  return calculateMonthlyCost(4);
}

/**
 * 추천 적용 시 예상 월간 비용 계산
 *
 * @param recommendations - 적용할 추천 목록
 * @returns 총 예상 절감 후 월간 비용
 */
export function calculateProjectedCost(recommendations: CostRecommendation[]): number {
  if (recommendations.length === 0) {
    return getBaselineMonthlyCost();
  }

  // 가장 낮은 projectedCost 반환 (추천들이 겹칠 수 있으므로)
  const lowestProjected = Math.min(...recommendations.map(r => r.projectedCost));
  return lowestProjected;
}

// ============================================================
// AI Integration
// ============================================================

/**
 * AI 프롬프트용 시스템 메시지
 */
const SYSTEM_PROMPT = `You are a cloud cost optimization advisor for an Optimism L2 Rollup infrastructure running on AWS Fargate.

## Your Role
Analyze vCPU usage patterns and scaling history to identify cost optimization opportunities.

## Infrastructure Context
- Platform: AWS Fargate (Seoul Region: ap-northeast-2)
- Pricing:
  - vCPU: $0.04656 per hour
  - Memory: $0.00511 per GB-hour
  - Memory allocation: vCPU * 2 GiB (e.g., 2 vCPU = 4 GiB)
- vCPU Range: 1-4 vCPU (dynamic scaling)
- Baseline comparison: Fixed 4 vCPU = ~$166/month

## Optimism L2 Workload Characteristics
- Batcher submits batches every 2-5 minutes
- Sequencer produces blocks every 2 seconds
- Traffic patterns: typically lower on weekends and night hours (KST)
- Peak hours: weekday business hours (9am-6pm KST)

## Recommendation Types
1. **downscale**: Reduce max vCPU or adjust idle thresholds
2. **schedule**: Time-based scaling (e.g., 1 vCPU at night, 2 vCPU during day)
3. **reserved**: Compare with Savings Plans or Reserved Capacity
4. **right-size**: Adjust current allocation based on actual usage

## Response Requirements
- All text descriptions should be in Korean
- Be specific about implementation steps
- Include risk assessment for each recommendation
- Calculate exact USD savings based on provided pricing

Respond ONLY in valid JSON format without markdown code blocks.`;

/**
 * 사용자 프롬프트 템플릿 생성
 */
function buildUserPrompt(
  patterns: UsagePattern[],
  scalingHistory: ScalingHistoryEntry[],
  summary: { avgVcpu: number; peakVcpu: number; avgUtilization: number; dataPointCount: number },
  days: number
): string {
  // 시간대별 패턴을 읽기 쉽게 포맷팅
  const patternSummary = patterns.map(p => ({
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.dayOfWeek],
    hour: p.hourOfDay,
    avgVcpu: p.avgVcpu,
    peakVcpu: p.peakVcpu,
    utilization: p.avgUtilization,
    samples: p.sampleCount,
  }));

  // 스케일링 이력 요약
  const historyEvents = scalingHistory.slice(0, 20).map(entry => ({
    time: entry.timestamp,
    from: entry.fromVcpu,
    to: entry.toVcpu,
    reason: entry.reason,
    trigger: entry.triggeredBy,
  }));

  // 현재 비용 계산
  const currentMonthlyCost = calculateMonthlyCost(summary.avgVcpu);
  const baselineCost = getBaselineMonthlyCost();

  return `## Analysis Period
${days} days of usage data, ${summary.dataPointCount} data points collected.

## Usage Summary
- Average vCPU: ${summary.avgVcpu}
- Peak vCPU: ${summary.peakVcpu}
- Average CPU Utilization: ${summary.avgUtilization}%

## Current Monthly Cost (based on average)
$${currentMonthlyCost.toFixed(2)}/month

## Baseline Comparison (Fixed 4 vCPU)
$${baselineCost.toFixed(2)}/month

## Time-based Usage Patterns (Day x Hour)
${JSON.stringify(patternSummary, null, 2)}

## Recent Scaling Events
${JSON.stringify(historyEvents, null, 2)}

## Instructions
Analyze the above data and provide cost optimization recommendations.

For each recommendation, include:
1. type: 'downscale' | 'schedule' | 'reserved' | 'right-size'
2. title: 추천 제목 (Korean, 20자 이내)
3. description: 상세 설명 (Korean, 100자 이내)
4. currentCost: 현재 월간 비용 (USD)
5. projectedCost: 적용 후 예상 월간 비용 (USD)
6. savingsPercent: 절감률 (0-100)
7. confidence: 신뢰도 (0-1)
8. implementation: 구현 방법 (Korean, 상세히)
9. risk: 'low' | 'medium' | 'high'

Also provide an overall insight summary in Korean.

Respond in this exact JSON format:
{
  "recommendations": [
    {
      "type": "schedule",
      "title": "...",
      "description": "...",
      "currentCost": 123.45,
      "projectedCost": 98.76,
      "savingsPercent": 20,
      "confidence": 0.85,
      "implementation": "...",
      "risk": "low"
    }
  ],
  "insight": "전체 인사이트 요약 (Korean)"
}`;
}

/**
 * AI에서 추천 생성 요청
 */
async function getAIRecommendations(
  patterns: UsagePattern[],
  scalingHistory: ScalingHistoryEntry[],
  summary: { avgVcpu: number; peakVcpu: number; avgUtilization: number; dataPointCount: number },
  days: number
): Promise<{ recommendations: CostRecommendation[]; insight: string }> {
  const userPrompt = buildUserPrompt(patterns, scalingHistory, summary, days);

  try {
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
      throw new Error(`AI Gateway responded with ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || data.output || '{}';

    // JSON 파싱 (마크다운 코드 블록 제거)
    const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    // 응답 검증
    const recommendations: CostRecommendation[] = (parsed.recommendations || []).map((r: Record<string, unknown>) => ({
      type: validateRecommendationType(r.type as string),
      title: String(r.title || '추천 사항'),
      description: String(r.description || ''),
      currentCost: Number(r.currentCost) || calculateMonthlyCost(summary.avgVcpu),
      projectedCost: Number(r.projectedCost) || calculateMonthlyCost(summary.avgVcpu),
      savingsPercent: Math.min(Math.max(Number(r.savingsPercent) || 0, 0), 100),
      confidence: Math.min(Math.max(Number(r.confidence) || 0.5, 0), 1),
      implementation: String(r.implementation || ''),
      risk: validateRisk(r.risk as string),
    }));

    const insight = String(parsed.insight || '데이터 분석을 완료했습니다.');

    return { recommendations, insight };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Cost Optimizer] AI Gateway Error:', errorMessage);

    // Fallback: 기본 추천 생성
    return generateFallbackRecommendations(summary, days);
  }
}

/**
 * 추천 유형 검증
 */
function validateRecommendationType(type: string): CostRecommendation['type'] {
  const validTypes: CostRecommendation['type'][] = ['downscale', 'schedule', 'reserved', 'right-size'];
  if (validTypes.includes(type as CostRecommendation['type'])) {
    return type as CostRecommendation['type'];
  }
  return 'right-size';
}

/**
 * 위험도 검증
 */
function validateRisk(risk: string): CostRecommendation['risk'] {
  const validRisks: CostRecommendation['risk'][] = ['low', 'medium', 'high'];
  if (validRisks.includes(risk as CostRecommendation['risk'])) {
    return risk as CostRecommendation['risk'];
  }
  return 'medium';
}

/**
 * Fallback 추천 생성 (AI 실패 시)
 */
function generateFallbackRecommendations(
  summary: { avgVcpu: number; peakVcpu: number; avgUtilization: number; dataPointCount: number },
  days: number
): { recommendations: CostRecommendation[]; insight: string } {
  const recommendations: CostRecommendation[] = [];
  const currentCost = calculateMonthlyCost(summary.avgVcpu);

  // 평균 사용률이 낮으면 축소 추천
  if (summary.avgUtilization < 30 && summary.avgVcpu > 1) {
    const projectedCost = calculateMonthlyCost(Math.max(summary.avgVcpu - 1, 1));
    recommendations.push({
      type: 'downscale',
      title: '유휴 리소스 축소',
      description: `평균 CPU 사용률이 ${summary.avgUtilization.toFixed(0)}%로 낮습니다. 최소 vCPU를 줄여 비용을 절감할 수 있습니다.`,
      currentCost,
      projectedCost,
      savingsPercent: Math.round(((currentCost - projectedCost) / currentCost) * 100),
      confidence: 0.7,
      implementation: 'ScalingConfig의 minVcpu를 1로 유지하고, idle threshold를 현재 사용률 기준으로 조정하세요.',
      risk: 'low',
    });
  }

  // 데이터가 충분하면 스케줄링 추천
  if (days >= 3 && summary.dataPointCount > 100) {
    const nightCost = calculateMonthlyCost(1);
    const dayCost = calculateMonthlyCost(2);
    const scheduledCost = (nightCost * 10 + dayCost * 14) / 24; // 10시간 야간, 14시간 주간

    recommendations.push({
      type: 'schedule',
      title: '시간 기반 스케줄링',
      description: '야간(22시-8시)에는 1 vCPU, 주간에는 2 vCPU로 자동 조정하여 비용을 최적화합니다.',
      currentCost,
      projectedCost: Math.round(scheduledCost * 100) / 100,
      savingsPercent: Math.round(((currentCost - scheduledCost) / currentCost) * 100),
      confidence: 0.6,
      implementation: 'K8s CronJob을 설정하여 시간대별 vCPU를 자동으로 조정합니다. 또는 AWS EventBridge 스케줄러를 사용할 수 있습니다.',
      risk: 'medium',
    });
  }

  const insight = `${days}일간 ${summary.dataPointCount}개의 데이터를 분석했습니다. ` +
    `평균 vCPU ${summary.avgVcpu}, 최대 ${summary.peakVcpu}, 평균 CPU 사용률 ${summary.avgUtilization.toFixed(1)}%입니다. ` +
    `AI 분석이 실패하여 기본 추천을 제공합니다.`;

  return { recommendations, insight };
}

// ============================================================
// Main Export: Generate Cost Report
// ============================================================

/**
 * 비용 분석 리포트 생성
 *
 * @param days - 분석 기간 (기본값: 7, 최대: 30)
 * @returns CostReport 객체
 *
 * @example
 * ```typescript
 * const report = await generateCostReport(7);
 * console.log(`총 절감 가능: ${report.totalSavingsPercent}%`);
 * ```
 */
export async function generateCostReport(days: number = 7): Promise<CostReport> {
  // 기간 제한
  const effectiveDays = Math.min(Math.max(days, 1), 30);

  // 데이터 수집
  const patterns = analyzePatterns(effectiveDays);
  const summary = getUsageSummary(effectiveDays);
  const scalingHistory = getScalingHistory(50);

  // 현재 비용 계산
  const currentMonthly = calculateMonthlyCost(summary.avgVcpu);

  // AI 추천 생성
  const { recommendations, insight } = await getAIRecommendations(
    patterns,
    scalingHistory,
    summary,
    effectiveDays
  );

  // 최적화 비용 계산
  const optimizedMonthly = recommendations.length > 0
    ? Math.min(...recommendations.map(r => r.projectedCost))
    : currentMonthly;

  // 총 절감률 계산
  const totalSavingsPercent = currentMonthly > 0
    ? Math.round(((currentMonthly - optimizedMonthly) / currentMonthly) * 100)
    : 0;

  // UUID 생성 (간단한 버전)
  const id = `cost-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  return {
    id,
    generatedAt: new Date().toISOString(),
    currentMonthly,
    optimizedMonthly,
    totalSavingsPercent,
    recommendations,
    usagePatterns: patterns,
    aiInsight: insight,
    periodDays: effectiveDays,
  };
}
```

---

### 3.3 파일 생성: `src/app/api/cost-report/route.ts`

비용 분석 API 엔드포인트.

```typescript
/**
 * Cost Report API
 * GET /api/cost-report - 비용 분석 리포트 생성
 */

import { NextResponse } from 'next/server';
import { generateCostReport } from '@/lib/cost-optimizer';

// 동적 라우트로 설정 (캐싱 비활성화)
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const daysParam = url.searchParams.get('days');

    // 기본값 7일, 최대 30일
    let days = 7;
    if (daysParam) {
      const parsed = parseInt(daysParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        days = Math.min(parsed, 30);
      }
    }

    console.log(`[Cost Report API] Generating report for ${days} days`);
    const startTime = Date.now();

    const report = await generateCostReport(days);

    console.log(`[Cost Report API] Report generated in ${Date.now() - startTime}ms`);

    return NextResponse.json(report, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Cost Report API] Error:', errorMessage);

    return NextResponse.json(
      {
        error: 'Failed to generate cost report',
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}
```

---

## 4. 기존 파일 수정

### 4.1 수정: `src/app/api/metrics/route.ts`

사용량 데이터를 usage-tracker에 기록하도록 수정.

**위치:** 파일 상단 import 영역에 추가

```typescript
// 기존 import들...
import { createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { NextResponse } from 'next/server';

// === 추가 ===
import { recordUsage } from '@/lib/usage-tracker';
```

**위치:** GET 핸들러 내부, 비용 계산 이후 (약 420-425 라인 사이)

**Before:**
```typescript
        const currentHourlyCost = opGethMonthlyCost / HOURS_PER_MONTH;

        const response = NextResponse.json({
```

**After:**
```typescript
        const currentHourlyCost = opGethMonthlyCost / HOURS_PER_MONTH;

        // === 추가: 사용량 데이터 기록 ===
        // 스트레스 테스트 모드가 아닐 때만 기록 (실제 운영 데이터만 수집)
        if (!isStressTest) {
          recordUsage(currentVcpu, effectiveCpu);
        }

        const response = NextResponse.json({
```

### 4.2 수정: `src/app/page.tsx`

비용 분석 UI 추가.

**위치:** import 영역에 추가

```typescript
// 기존 import들...
import {
  Activity, Server, Zap, ShieldAlert, Cpu, ArrowUpRight,
  TrendingDown, FileText, CheckCircle2, XCircle, Shield
} from 'lucide-react';

// === 추가 ===
import { BarChart3, Calendar, Lightbulb, AlertTriangle, ChevronRight } from 'lucide-react';
```

**위치:** MetricData 인터페이스 아래에 타입 추가

```typescript
interface MetricData {
  // ... 기존 코드 ...
}

// === 추가: Cost Report 타입 ===
interface CostReportData {
  id: string;
  generatedAt: string;
  currentMonthly: number;
  optimizedMonthly: number;
  totalSavingsPercent: number;
  recommendations: Array<{
    type: 'downscale' | 'schedule' | 'reserved' | 'right-size';
    title: string;
    description: string;
    currentCost: number;
    projectedCost: number;
    savingsPercent: number;
    confidence: number;
    implementation: string;
    risk: 'low' | 'medium' | 'high';
  }>;
  usagePatterns: Array<{
    dayOfWeek: number;
    hourOfDay: number;
    avgVcpu: number;
    peakVcpu: number;
    avgUtilization: number;
    sampleCount: number;
  }>;
  aiInsight: string;
  periodDays: number;
}
```

**위치:** Dashboard 컴포넌트 내 state 선언 영역에 추가

```typescript
export default function Dashboard() {
  // 기존 state들...
  const [dataHistory, setDataHistory] = useState<{ name: string; cpu: number; gethVcpu: number; gethMemGiB: number; saving: number; cost: number }[]>([]);
  const [current, setCurrent] = useState<MetricData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stressMode, setStressMode] = useState(false);
  const [logInsight, setLogInsight] = useState<{ summary: string; severity: string; timestamp: string; action_item?: string } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // === 추가: Cost Report state ===
  const [costReport, setCostReport] = useState<CostReportData | null>(null);
  const [isLoadingCostReport, setIsLoadingCostReport] = useState(false);
  const [showCostAnalysis, setShowCostAnalysis] = useState(false);
```

**위치:** checkLogs 함수 아래에 새 함수 추가

```typescript
  const checkLogs = async (mode: string) => {
    // ... 기존 코드 ...
  };

  // === 추가: 비용 분석 함수 ===
  const fetchCostReport = async () => {
    setIsLoadingCostReport(true);
    setCostReport(null);
    try {
      const res = await fetch('/api/cost-report?days=7');
      if (!res.ok) throw new Error('Failed to fetch cost report');
      const data = await res.json();
      setCostReport(data);
      setShowCostAnalysis(true);
    } catch (e) {
      console.error('Cost report error:', e);
    } finally {
      setIsLoadingCostReport(false);
    }
  };
```

**위치:** Resource Center 섹션의 "Total Saved Card (Dark)" 부분을 교체

**Before (전체 교체할 영역 - 약 304-326 라인):**
```typescript
          {/* Total Saved Card (Dark) */}
          <div className="mt-auto bg-[#1A1D21] rounded-2xl p-5 text-white">
            <div className="flex justify-between items-start mb-2">
              <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
                {current?.cost.isPeakMode ? 'Cost Increase (Peak)' : 'Total Saved (MTD)'}
              </span>
              {current?.cost.isPeakMode
                ? <ArrowUpRight size={18} className="text-red-400" />
                : <TrendingDown size={18} className="text-green-400" />
              }
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black">
                ${Math.abs(current?.cost.monthlySaving || 124).toFixed(0)}
              </span>
              <span className={`text-sm font-bold ${current?.cost.isPeakMode ? 'text-red-400' : 'text-green-400'}`}>
                {current?.cost.isPeakMode ? '+' : '-'}{Math.abs((current?.cost.monthlySaving || 0) / (current?.cost.fixedCost || 166) * 100).toFixed(0)}%
              </span>
            </div>
            <p className="text-gray-400 text-xs mt-2 leading-relaxed">
              <span className="text-gray-300">vs Fixed 4 vCPU (${current?.cost.fixedCost?.toFixed(0) || '166'}/mo)</span> — {current?.cost.isPeakMode ? 'Scaling up to handle traffic spike.' : 'AI-driven scaling reduced Fargate costs.'}
            </p>
          </div>
```

**After (새로운 확장 비용 대시보드):**
```typescript
          {/* Cost Dashboard (Dark) - Expanded */}
          <div className="mt-auto bg-[#1A1D21] rounded-2xl p-5 text-white">
            {/* Header with Cost Analysis Button */}
            <div className="flex justify-between items-start mb-3">
              <div>
                <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
                  {current?.cost.isPeakMode ? 'Cost Increase (Peak)' : 'Total Saved (MTD)'}
                </span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-black">
                    ${Math.abs(current?.cost.monthlySaving || 124).toFixed(0)}
                  </span>
                  <span className={`text-sm font-bold ${current?.cost.isPeakMode ? 'text-red-400' : 'text-green-400'}`}>
                    {current?.cost.isPeakMode ? '+' : '-'}{Math.abs((current?.cost.monthlySaving || 0) / (current?.cost.fixedCost || 166) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              <button
                onClick={fetchCostReport}
                disabled={isLoadingCostReport}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  isLoadingCostReport
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                {isLoadingCostReport ? (
                  <Activity className="animate-spin" size={12} />
                ) : (
                  <BarChart3 size={12} />
                )}
                {isLoadingCostReport ? '분석 중...' : 'COST ANALYSIS'}
              </button>
            </div>

            <p className="text-gray-400 text-xs leading-relaxed">
              <span className="text-gray-300">vs Fixed 4 vCPU (${current?.cost.fixedCost?.toFixed(0) || '166'}/mo)</span> — {current?.cost.isPeakMode ? 'Scaling up to handle traffic spike.' : 'AI-driven scaling reduced Fargate costs.'}
            </p>

            {/* Cost Analysis Panel (Expandable) */}
            {showCostAnalysis && costReport && (
              <div className="mt-4 pt-4 border-t border-gray-700">
                {/* AI Insight */}
                <div className="mb-4 p-3 bg-blue-900/30 rounded-xl border border-blue-800/50">
                  <div className="flex items-start gap-2">
                    <Lightbulb size={14} className="text-blue-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-200 leading-relaxed">{costReport.aiInsight}</p>
                  </div>
                </div>

                {/* Usage Heatmap */}
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar size={12} className="text-gray-400" />
                    <span className="text-[10px] text-gray-400 font-semibold uppercase">사용 패턴 (최근 {costReport.periodDays}일)</span>
                  </div>
                  <UsageHeatmap patterns={costReport.usagePatterns} />
                </div>

                {/* Recommendations */}
                {costReport.recommendations.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-gray-400 font-semibold uppercase">최적화 추천</span>
                      <span className="text-[10px] text-green-400 font-bold">최대 {costReport.totalSavingsPercent}% 절감 가능</span>
                    </div>
                    <div className="space-y-2">
                      {costReport.recommendations.slice(0, 3).map((rec, idx) => (
                        <RecommendationCard key={idx} recommendation={rec} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Close Button */}
                <button
                  onClick={() => setShowCostAnalysis(false)}
                  className="w-full mt-3 py-2 text-xs text-gray-400 hover:text-gray-300 transition-colors"
                >
                  닫기
                </button>
              </div>
            )}
          </div>
```

**위치:** 파일 끝, LogBlock 컴포넌트 아래에 새 컴포넌트 추가

```typescript
function LogBlock({ time, source, level, msg, highlight, color }: { time: string; source: string; level: string; msg: string; highlight?: boolean; color?: string }) {
  // ... 기존 코드 ...
}

// === 추가: Usage Heatmap 컴포넌트 ===
function UsageHeatmap({ patterns }: { patterns: CostReportData['usagePatterns'] }) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // 패턴 데이터를 2D 맵으로 변환
  const patternMap = new Map<string, { avgVcpu: number; avgUtilization: number }>();
  patterns.forEach(p => {
    patternMap.set(`${p.dayOfWeek}-${p.hourOfDay}`, {
      avgVcpu: p.avgVcpu,
      avgUtilization: p.avgUtilization,
    });
  });

  // 사용률에 따른 색상 결정
  const getColor = (utilization: number): string => {
    if (utilization === 0) return 'bg-gray-800';
    if (utilization < 20) return 'bg-green-900/60';
    if (utilization < 40) return 'bg-green-700/60';
    if (utilization < 60) return 'bg-yellow-700/60';
    if (utilization < 80) return 'bg-orange-700/60';
    return 'bg-red-700/60';
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[400px]">
        {/* Hour labels */}
        <div className="flex ml-6 mb-1">
          {[0, 4, 8, 12, 16, 20].map(h => (
            <div key={h} className="text-[8px] text-gray-500 font-mono" style={{ marginLeft: h === 0 ? 0 : 'calc((100% - 48px) / 6 - 8px)', width: '16px' }}>
              {h}시
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="space-y-0.5">
          {days.map((day, dayIdx) => (
            <div key={day} className="flex items-center gap-1">
              <span className="w-5 text-[9px] text-gray-500 font-medium">{day}</span>
              <div className="flex-1 flex gap-px">
                {hours.map(hour => {
                  const data = patternMap.get(`${dayIdx}-${hour}`);
                  const utilization = data?.avgUtilization || 0;
                  const vcpu = data?.avgVcpu || 0;

                  return (
                    <div
                      key={hour}
                      className={`flex-1 h-3 rounded-sm ${getColor(utilization)} transition-colors hover:ring-1 hover:ring-white/30`}
                      title={`${days[dayIdx]} ${hour}:00 - 평균 ${vcpu.toFixed(1)} vCPU, ${utilization.toFixed(0)}% 사용률`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end gap-2 mt-2">
          <span className="text-[8px] text-gray-500">낮음</span>
          <div className="flex gap-px">
            <div className="w-3 h-2 rounded-sm bg-green-900/60" />
            <div className="w-3 h-2 rounded-sm bg-green-700/60" />
            <div className="w-3 h-2 rounded-sm bg-yellow-700/60" />
            <div className="w-3 h-2 rounded-sm bg-orange-700/60" />
            <div className="w-3 h-2 rounded-sm bg-red-700/60" />
          </div>
          <span className="text-[8px] text-gray-500">높음</span>
        </div>
      </div>
    </div>
  );
}

// === 추가: Recommendation Card 컴포넌트 ===
function RecommendationCard({ recommendation }: { recommendation: CostReportData['recommendations'][0] }) {
  const [expanded, setExpanded] = useState(false);

  const riskStyles = {
    low: { bg: 'bg-green-900/30', text: 'text-green-400', label: '낮음' },
    medium: { bg: 'bg-yellow-900/30', text: 'text-yellow-400', label: '중간' },
    high: { bg: 'bg-red-900/30', text: 'text-red-400', label: '높음' },
  };

  const typeIcons = {
    downscale: TrendingDown,
    schedule: Calendar,
    reserved: Shield,
    'right-size': BarChart3,
  };

  const Icon = typeIcons[recommendation.type] || BarChart3;
  const risk = riskStyles[recommendation.risk];

  return (
    <div
      className={`p-3 rounded-xl border border-gray-700/50 bg-gray-800/30 cursor-pointer transition-all hover:bg-gray-800/50`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <Icon size={14} className="text-blue-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-white">{recommendation.title}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{recommendation.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-bold text-green-400">-${(recommendation.currentCost - recommendation.projectedCost).toFixed(0)}/월</span>
          <ChevronRight size={14} className={`text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-700/50">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="text-center">
              <p className="text-[9px] text-gray-500 uppercase">현재 비용</p>
              <p className="text-xs font-bold text-white">${recommendation.currentCost.toFixed(0)}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-gray-500 uppercase">예상 비용</p>
              <p className="text-xs font-bold text-green-400">${recommendation.projectedCost.toFixed(0)}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-gray-500 uppercase">절감률</p>
              <p className="text-xs font-bold text-green-400">{recommendation.savingsPercent}%</p>
            </div>
          </div>

          {/* Risk & Confidence */}
          <div className="flex items-center gap-3 mb-3">
            <div className={`px-2 py-0.5 rounded text-[9px] font-bold ${risk.bg} ${risk.text}`}>
              위험도: {risk.label}
            </div>
            <div className="text-[9px] text-gray-400">
              신뢰도: {(recommendation.confidence * 100).toFixed(0)}%
            </div>
          </div>

          {/* Implementation */}
          <div className="p-2 bg-gray-900/50 rounded-lg">
            <p className="text-[9px] text-gray-400 uppercase mb-1">구현 방법</p>
            <p className="text-[10px] text-gray-300 leading-relaxed">{recommendation.implementation}</p>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 5. API 명세

### 5.1 GET /api/cost-report

비용 분석 리포트를 생성합니다.

**Query Parameters:**

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| days | number | No | 7 | 분석 기간 (1-30일) |

**Request Example:**
```bash
curl "http://localhost:3002/api/cost-report?days=7"
```

**Response (200 OK):**
```json
{
  "id": "cost-1707235200000-abc123",
  "generatedAt": "2026-02-06T15:00:00.000Z",
  "currentMonthly": 62.45,
  "optimizedMonthly": 48.32,
  "totalSavingsPercent": 23,
  "recommendations": [
    {
      "type": "schedule",
      "title": "야간 시간대 리소스 축소",
      "description": "22시-08시 사이에 트래픽이 평균 대비 60% 감소합니다. 이 시간대에 1 vCPU로 운영하면 비용을 절감할 수 있습니다.",
      "currentCost": 62.45,
      "projectedCost": 48.32,
      "savingsPercent": 23,
      "confidence": 0.85,
      "implementation": "K8s CronJob을 설정하여 22시에 scaler API를 호출하여 1 vCPU로 축소하고, 08시에 2 vCPU로 복원합니다. 또는 AWS EventBridge 스케줄러와 Lambda를 조합하여 자동화할 수 있습니다.",
      "risk": "low"
    },
    {
      "type": "right-size",
      "title": "평균 사용률 기반 최적화",
      "description": "현재 평균 CPU 사용률이 25%로 낮습니다. 스케일링 임계치를 조정하여 불필요한 스케일업을 방지할 수 있습니다.",
      "currentCost": 62.45,
      "projectedCost": 51.20,
      "savingsPercent": 18,
      "confidence": 0.72,
      "implementation": "scaling-decision.ts의 DEFAULT_SCALING_CONFIG에서 thresholds.idle을 30에서 40으로, thresholds.normal을 70에서 80으로 조정하세요.",
      "risk": "medium"
    }
  ],
  "usagePatterns": [
    {
      "dayOfWeek": 0,
      "hourOfDay": 0,
      "avgVcpu": 1.2,
      "peakVcpu": 2,
      "avgUtilization": 15.5,
      "sampleCount": 42
    },
    {
      "dayOfWeek": 0,
      "hourOfDay": 1,
      "avgVcpu": 1.1,
      "peakVcpu": 1,
      "avgUtilization": 12.3,
      "sampleCount": 38
    }
  ],
  "aiInsight": "지난 7일간 사용 패턴을 분석한 결과, 야간 시간대(22시-08시)와 주말에 트래픽이 현저히 감소하는 패턴이 확인됩니다. 평균 vCPU 1.3, 최대 4 vCPU를 사용했으며, 평균 CPU 사용률은 28%입니다. 시간 기반 스케줄링을 적용하면 월간 약 $14의 비용을 절감할 수 있습니다.",
  "periodDays": 7
}
```

**Error Response (500 Internal Server Error):**
```json
{
  "error": "Failed to generate cost report",
  "message": "AI Gateway responded with 503: Service Unavailable"
}
```

---

## 6. AI 프롬프트 전문

### 6.1 System Prompt (전문)

```
You are a cloud cost optimization advisor for an Optimism L2 Rollup infrastructure running on AWS Fargate.

## Your Role
Analyze vCPU usage patterns and scaling history to identify cost optimization opportunities.

## Infrastructure Context
- Platform: AWS Fargate (Seoul Region: ap-northeast-2)
- Pricing:
  - vCPU: $0.04656 per hour
  - Memory: $0.00511 per GB-hour
  - Memory allocation: vCPU * 2 GiB (e.g., 2 vCPU = 4 GiB)
- vCPU Range: 1-4 vCPU (dynamic scaling)
- Baseline comparison: Fixed 4 vCPU = ~$166/month

## Optimism L2 Workload Characteristics
- Batcher submits batches every 2-5 minutes
- Sequencer produces blocks every 2 seconds
- Traffic patterns: typically lower on weekends and night hours (KST)
- Peak hours: weekday business hours (9am-6pm KST)

## Recommendation Types
1. **downscale**: Reduce max vCPU or adjust idle thresholds
2. **schedule**: Time-based scaling (e.g., 1 vCPU at night, 2 vCPU during day)
3. **reserved**: Compare with Savings Plans or Reserved Capacity
4. **right-size**: Adjust current allocation based on actual usage

## Response Requirements
- All text descriptions should be in Korean
- Be specific about implementation steps
- Include risk assessment for each recommendation
- Calculate exact USD savings based on provided pricing

Respond ONLY in valid JSON format without markdown code blocks.
```

### 6.2 User Prompt Template (전문)

```
## Analysis Period
{days} days of usage data, {dataPointCount} data points collected.

## Usage Summary
- Average vCPU: {avgVcpu}
- Peak vCPU: {peakVcpu}
- Average CPU Utilization: {avgUtilization}%

## Current Monthly Cost (based on average)
${currentMonthlyCost}/month

## Baseline Comparison (Fixed 4 vCPU)
${baselineCost}/month

## Time-based Usage Patterns (Day x Hour)
[
  { "day": "Mon", "hour": 9, "avgVcpu": 2.1, "peakVcpu": 4, "utilization": 67.5, "samples": 28 },
  { "day": "Mon", "hour": 10, "avgVcpu": 2.3, "peakVcpu": 4, "utilization": 72.1, "samples": 31 },
  ...
]

## Recent Scaling Events
[
  { "time": "2026-02-06T10:30:00Z", "from": 1, "to": 2, "reason": "Normal Load Detected", "trigger": "auto" },
  { "time": "2026-02-06T14:15:00Z", "from": 2, "to": 4, "reason": "High Load Detected", "trigger": "auto" },
  ...
]

## Instructions
Analyze the above data and provide cost optimization recommendations.

For each recommendation, include:
1. type: 'downscale' | 'schedule' | 'reserved' | 'right-size'
2. title: 추천 제목 (Korean, 20자 이내)
3. description: 상세 설명 (Korean, 100자 이내)
4. currentCost: 현재 월간 비용 (USD)
5. projectedCost: 적용 후 예상 월간 비용 (USD)
6. savingsPercent: 절감률 (0-100)
7. confidence: 신뢰도 (0-1)
8. implementation: 구현 방법 (Korean, 상세히)
9. risk: 'low' | 'medium' | 'high'

Also provide an overall insight summary in Korean.

Respond in this exact JSON format:
{
  "recommendations": [
    {
      "type": "schedule",
      "title": "...",
      "description": "...",
      "currentCost": 123.45,
      "projectedCost": 98.76,
      "savingsPercent": 20,
      "confidence": 0.85,
      "implementation": "...",
      "risk": "low"
    }
  ],
  "insight": "전체 인사이트 요약 (Korean)"
}
```

### 6.3 Expected AI Response Format

```json
{
  "recommendations": [
    {
      "type": "schedule",
      "title": "야간 자동 스케일다운",
      "description": "22시-08시 트래픽이 평균 대비 65% 감소합니다. 이 시간대에 1 vCPU로 운영 시 비용 절감이 가능합니다.",
      "currentCost": 62.45,
      "projectedCost": 48.32,
      "savingsPercent": 23,
      "confidence": 0.88,
      "implementation": "K8s CronJob 2개를 생성합니다:\n1. 22:00 KST - POST /api/scaler {targetVcpu: 1}\n2. 08:00 KST - POST /api/scaler {targetVcpu: 2}\n\nCronJob YAML 예시:\n```yaml\napiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: scale-down-night\nspec:\n  schedule: \"0 22 * * *\"\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          containers:\n          - name: scaler\n            image: curlimages/curl\n            command: [\"curl\", \"-X\", \"POST\", \"http://sentinai:3000/api/scaler\", \"-d\", '{\"targetVcpu\":1}']\n```",
      "risk": "low"
    },
    {
      "type": "right-size",
      "title": "스케일링 임계치 최적화",
      "description": "평균 사용률 28%로 idle 임계치(30) 근처입니다. 임계치 상향 조정으로 불필요한 스케일업을 방지할 수 있습니다.",
      "currentCost": 62.45,
      "projectedCost": 55.10,
      "savingsPercent": 12,
      "confidence": 0.72,
      "implementation": "src/types/scaling.ts의 DEFAULT_SCALING_CONFIG를 수정합니다:\n\nBefore:\nthresholds: { idle: 30, normal: 70 }\n\nAfter:\nthresholds: { idle: 40, normal: 80 }\n\n이렇게 하면 score가 40 미만일 때만 1 vCPU로 유지되고, 80 이상일 때만 4 vCPU로 스케일업됩니다.",
      "risk": "medium"
    }
  ],
  "insight": "7일간 1,440개 데이터를 분석한 결과, 야간(22시-08시)과 주말에 트래픽이 현저히 감소하는 패턴이 확인됩니다. 현재 평균 1.3 vCPU, 평균 사용률 28%로 리소스 여유가 있습니다. 시간 기반 스케줄링만 적용해도 월 $14(23%) 절감이 가능하며, 임계치 조정을 함께 적용하면 최대 $18(29%)까지 절감할 수 있습니다. 위험도는 낮으며, 피크 시간대 성능에 영향을 주지 않습니다."
}
```

---

## 7. 환경 변수

### 7.1 새로운 환경 변수

`.env.local.sample`에 추가:

```bash
# Cost Optimizer (Proposal 4)
# 사용량 추적 활성화 여부 (기본값: true)
# false로 설정하면 사용량 데이터를 수집하지 않음
COST_TRACKING_ENABLED=true
```

### 7.2 기존 환경 변수 (필수)

이 기능은 기존 AI Gateway 설정을 사용합니다:

```bash
# AI Configuration (Required for Cost Analysis)
AI_GATEWAY_URL=https://api.ai.tokamak.network
ANTHROPIC_API_KEY=your-api-key-here
```

---

## 8. 테스트 검증

### 8.1 API 테스트 (curl)

**기본 리포트 생성:**
```bash
curl -X GET "http://localhost:3002/api/cost-report" | jq
```

**14일 분석:**
```bash
curl -X GET "http://localhost:3002/api/cost-report?days=14" | jq
```

**응답 확인 항목:**
- `id`: 고유 ID가 생성되었는지
- `recommendations`: 최소 1개 이상의 추천이 있는지
- `usagePatterns`: 데이터가 있으면 패턴이 포함되어 있는지
- `aiInsight`: 한글로 인사이트가 작성되었는지

### 8.2 UI 테스트

**시나리오 1: 정상 흐름**
1. 대시보드 접속 (`http://localhost:3002`)
2. Resource Center 하단의 "COST ANALYSIS" 버튼 클릭
3. 로딩 스피너 표시 확인
4. 분석 완료 후:
   - AI 인사이트 카드 표시
   - 사용 패턴 히트맵 표시
   - 추천 카드 목록 표시
5. 추천 카드 클릭 시 상세 정보 확장
6. "닫기" 버튼으로 패널 축소

**시나리오 2: 데이터 없음**
1. 서버 재시작 직후 (데이터 없는 상태)
2. "COST ANALYSIS" 버튼 클릭
3. Fallback 추천이 표시되는지 확인
4. "AI 분석이 실패하여 기본 추천을 제공합니다" 메시지 확인

**시나리오 3: 스트레스 모드 제외**
1. "Simulate Load" 버튼 클릭하여 스트레스 모드 활성화
2. 1-2분 대기 (데이터 수집)
3. 스트레스 모드 비활성화
4. "COST ANALYSIS" 실행
5. 8 vCPU 데이터가 패턴에 포함되지 않았는지 확인

### 8.3 Edge Cases

| 케이스 | 예상 동작 |
|--------|-----------|
| 사용량 데이터 0개 | 빈 패턴, Fallback 인사이트 |
| 1일치 데이터만 존재 | 제한된 패턴, 낮은 신뢰도 추천 |
| AI Gateway 타임아웃 | Fallback 추천 생성, 에러 로깅 |
| 잘못된 days 파라미터 | 기본값 7일 사용 |
| days > 30 | 30일로 제한 |

---

## 9. 의존관계

### 9.1 필수 의존성

| 모듈 | 설명 | 상태 |
|------|------|------|
| `src/lib/k8s-scaler.ts` | `getScalingHistory()` 함수 | 이미 존재 |
| AI Gateway | Claude API 호출 | 기존 패턴 존재 |

### 9.2 선택적 의존성 (Proposal 1)

`MetricsStore`가 구현되면 `usage-tracker.ts`를 확장하여 연동 가능:

```typescript
// 미래 확장 예시
import { getStats } from '@/lib/metrics-store';

export function enhancedPatternAnalysis(days: number) {
  const usagePatterns = analyzePatterns(days);
  const metricsStats = getStats(days * 24 * 60, 'cpuUsage'); // Proposal 1

  return {
    patterns: usagePatterns,
    trend: metricsStats.trend, // 'rising' | 'falling' | 'stable'
  };
}
```

### 9.3 독립성

- **Proposal 2 (Anomaly Detection):** 독립적, 별도 기능
- **Proposal 3 (RCA Engine):** 독립적, 별도 기능
- **Proposal 5 (NLOps):** 독립적, 향후 통합 가능

---

## 10. UI 상세 - Usage Heatmap

### 10.1 레이아웃 명세

**구조:**
- 7행 (일-토) x 24열 (0시-23시) 그리드
- 각 셀: 3px 높이, flex-1 너비
- 요일 레이블: 왼쪽 20px 폭
- 시간 레이블: 상단에 6시간 간격 (0, 4, 8, 12, 16, 20)

**색상 스케일 (CPU 사용률 기준):**

| 사용률 | 색상 클래스 | 설명 |
|--------|-------------|------|
| 0% | `bg-gray-800` | 데이터 없음 |
| 1-19% | `bg-green-900/60` | 매우 낮음 |
| 20-39% | `bg-green-700/60` | 낮음 |
| 40-59% | `bg-yellow-700/60` | 보통 |
| 60-79% | `bg-orange-700/60` | 높음 |
| 80%+ | `bg-red-700/60` | 매우 높음 |

### 10.2 인터랙션

**Hover Tooltip:**
```
월 14:00 - 평균 2.1 vCPU, 67% 사용률
```

**구현 (title 속성 사용):**
```tsx
title={`${days[dayOfWeek]} ${hour}:00 - 평균 ${vcpu.toFixed(1)} vCPU, ${utilization.toFixed(0)}% 사용률`}
```

### 10.3 반응형 고려

- `min-w-[400px]`: 최소 너비 보장
- `overflow-x-auto`: 작은 화면에서 가로 스크롤
- 모바일에서는 가로 스크롤 힌트 표시 가능

---

## 구현 체크리스트

구현 완료 후 확인할 항목:

- [ ] `src/types/cost.ts` 생성 및 모든 타입 정의
- [ ] `src/lib/usage-tracker.ts` 생성 및 함수 구현
- [ ] `src/lib/cost-optimizer.ts` 생성 및 AI 연동
- [ ] `src/app/api/cost-report/route.ts` 생성
- [ ] `src/app/api/metrics/route.ts`에 `recordUsage` 호출 추가
- [ ] `src/app/page.tsx`에 state, 함수, UI 컴포넌트 추가
- [ ] `.env.local.sample`에 `COST_TRACKING_ENABLED` 추가
- [ ] TypeScript 컴파일 오류 없음 (`npm run build`)
- [ ] ESLint 경고 없음 (`npm run lint`)
- [ ] 로컬 테스트 완료 (curl, UI)

---

## 문서 끝

이 문서는 Proposal 4: AI Cost Optimizer의 완전한 구현 명세입니다.
다른 파일이나 외부 문서 참조 없이 이 문서만으로 구현이 가능합니다.

작성일: 2026-02-06
버전: 1.0.0
