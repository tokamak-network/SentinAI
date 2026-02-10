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
import { chatCompletion } from './ai-client';
import { parseAIJSON } from './ai-response-parser';

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
    const aiResult = await chatCompletion({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      modelTier: 'best',
      temperature: 0.2,
    });

    const content = aiResult.content || '{}';

    // JSON 파싱
    const parsed = parseAIJSON<Record<string, unknown>>(content);

    // 응답 검증
    const recommendations: CostRecommendation[] = (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).map((r: unknown) => {
      const rec = r as Record<string, unknown>;
      return {
        type: validateRecommendationType(String(rec.type || '')),
        title: String(rec.title || '추천 사항'),
        description: String(rec.description || ''),
        currentCost: Number(rec.currentCost) || calculateMonthlyCost(summary.avgVcpu),
        projectedCost: Number(rec.projectedCost) || calculateMonthlyCost(summary.avgVcpu),
        savingsPercent: Math.min(Math.max(Number(rec.savingsPercent) || 0, 0), 100),
        confidence: Math.min(Math.max(Number(rec.confidence) || 0.5, 0), 1),
        implementation: String(rec.implementation || ''),
        risk: validateRisk(String(rec.risk || '')),
      };
    });

    const insight = String(parsed.insight || '데이터 분석을 완료했습니다.');

    return { recommendations, insight };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Cost Optimizer] AI provider error:', errorMessage);

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
  const patterns = await analyzePatterns(effectiveDays);
  const summary = await getUsageSummary(effectiveDays);
  const scalingHistory = await getScalingHistory(50);

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
