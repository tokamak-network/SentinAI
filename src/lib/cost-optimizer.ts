/**
 * AI Cost Optimizer Module
 * AI-powered cost optimization analysis and recommendation generation
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
import { getChainPlugin } from '@/chains';
import { generateSavingsAdvice } from './savings-advisor';

// ============================================================
// Cost Calculation Utilities
// ============================================================

/**
 * Calculate monthly cost for a given average vCPU
 */
export function calculateMonthlyCost(avgVcpu: number): number {
  const memoryGiB = avgVcpu * 2; // Memory = vCPU * 2
  const hourlyCost =
    avgVcpu * FARGATE_PRICING.vcpuPerHour +
    memoryGiB * FARGATE_PRICING.memGbPerHour;

  return Math.round(hourlyCost * TIME_CONSTANTS.HOURS_PER_MONTH * 100) / 100;
}

/**
 * Monthly cost for fixed 4 vCPU baseline
 */
export function getBaselineMonthlyCost(): number {
  return calculateMonthlyCost(4);
}

/**
 * Calculate projected monthly cost after applying recommendations
 */
export function calculateProjectedCost(recommendations: CostRecommendation[]): number {
  if (recommendations.length === 0) {
    return getBaselineMonthlyCost();
  }

  // Return the lowest projected cost (recommendations may overlap)
  const lowestProjected = Math.min(...recommendations.map(r => r.projectedCost));
  return lowestProjected;
}

// ============================================================
// AI Integration
// ============================================================

/**
 * System prompt for AI cost analysis
 */
function buildCostSystemPrompt(): string {
  const plugin = getChainPlugin();
  return `You are a cloud cost optimization advisor for a ${plugin.displayName} infrastructure running on AWS Fargate.

## Your Role
Analyze vCPU usage patterns and scaling history to identify cost optimization opportunities.

${plugin.aiPrompts.costOptimizerContext}

## Recommendation Types
1. **downscale**: Reduce max vCPU or adjust idle thresholds
2. **schedule**: Time-based scaling (e.g., 1 vCPU at night, 2 vCPU during day)
3. **reserved**: Compare with Savings Plans or Reserved Capacity
4. **right-size**: Adjust current allocation based on actual usage

## Response Requirements
- All text descriptions should be in English
- Be specific about implementation steps
- Include risk assessment for each recommendation
- Calculate exact USD savings based on provided pricing

Respond ONLY in valid JSON format without markdown code blocks.`;
}

/**
 * Build user prompt template for AI cost analysis
 */
function buildUserPrompt(
  patterns: UsagePattern[],
  scalingHistory: ScalingHistoryEntry[],
  summary: { avgVcpu: number; peakVcpu: number; avgUtilization: number; dataPointCount: number },
  days: number
): string {
  // Format time-based patterns for readability
  const patternSummary = patterns.map(p => ({
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.dayOfWeek],
    hour: p.hourOfDay,
    avgVcpu: p.avgVcpu,
    peakVcpu: p.peakVcpu,
    utilization: p.avgUtilization,
    samples: p.sampleCount,
  }));

  // Scaling history summary
  const historyEvents = scalingHistory.slice(0, 20).map(entry => ({
    time: entry.timestamp,
    from: entry.fromVcpu,
    to: entry.toVcpu,
    reason: entry.reason,
    trigger: entry.triggeredBy,
  }));

  // Current cost calculation
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
2. title: Short recommendation title (English, max 30 chars)
3. description: Detailed description (English, max 150 chars)
4. currentCost: Current monthly cost (USD)
5. projectedCost: Projected monthly cost after applying (USD)
6. savingsPercent: Savings percentage (0-100)
7. confidence: Confidence level (0-1)
8. implementation: Implementation steps (English, detailed)
9. risk: 'low' | 'medium' | 'high'

Also provide an overall insight summary in English (maximum 200 characters, must be a complete sentence).

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
  "insight": "Overall insight summary (English, max 200 chars)"
}`;
}

/**
 * Request AI-generated cost recommendations
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
      systemPrompt: buildCostSystemPrompt(),
      userPrompt,
      modelTier: 'best',
      temperature: 0.2,
    });

    const content = aiResult.content || '{}';

    // Parse JSON response
    const parsed = parseAIJSON<Record<string, unknown>>(content);

    // Validate response
    const recommendations: CostRecommendation[] = (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).map((r: unknown) => {
      const rec = r as Record<string, unknown>;
      return {
        type: validateRecommendationType(String(rec.type || '')),
        title: String(rec.title || 'Recommendation'),
        description: String(rec.description || ''),
        currentCost: Number(rec.currentCost) || calculateMonthlyCost(summary.avgVcpu),
        projectedCost: Number(rec.projectedCost) || calculateMonthlyCost(summary.avgVcpu),
        savingsPercent: Math.min(Math.max(Number(rec.savingsPercent) || 0, 0), 100),
        confidence: Math.min(Math.max(Number(rec.confidence) || 0.5, 0), 1),
        implementation: String(rec.implementation || ''),
        risk: validateRisk(String(rec.risk || '')),
      };
    });

    const insight = String(parsed.insight || 'Data analysis completed.');

    return { recommendations, insight };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Cost Optimizer] AI provider error:', errorMessage);

    // Fallback: generate default recommendations
    return generateFallbackRecommendations(summary, days);
  }
}

/**
 * Validate recommendation type
 */
function validateRecommendationType(type: string): CostRecommendation['type'] {
  const validTypes: CostRecommendation['type'][] = ['downscale', 'schedule', 'reserved', 'right-size'];
  if (validTypes.includes(type as CostRecommendation['type'])) {
    return type as CostRecommendation['type'];
  }
  return 'right-size';
}

/**
 * Validate risk level
 */
function validateRisk(risk: string): CostRecommendation['risk'] {
  const validRisks: CostRecommendation['risk'][] = ['low', 'medium', 'high'];
  if (validRisks.includes(risk as CostRecommendation['risk'])) {
    return risk as CostRecommendation['risk'];
  }
  return 'medium';
}

/**
 * Generate fallback recommendations (when AI fails)
 */
function generateFallbackRecommendations(
  summary: { avgVcpu: number; peakVcpu: number; avgUtilization: number; dataPointCount: number },
  days: number
): { recommendations: CostRecommendation[]; insight: string } {
  const recommendations: CostRecommendation[] = [];
  const currentCost = calculateMonthlyCost(summary.avgVcpu);

  // Recommend downscaling if average utilization is low
  if (summary.avgUtilization < 30 && summary.avgVcpu > 1) {
    const projectedCost = calculateMonthlyCost(Math.max(summary.avgVcpu - 1, 1));
    recommendations.push({
      type: 'downscale',
      title: 'Reduce Idle Resources',
      description: `Average CPU utilization is ${summary.avgUtilization.toFixed(0)}%, which is low. Reducing minimum vCPU can save costs.`,
      currentCost,
      projectedCost,
      savingsPercent: Math.round(((currentCost - projectedCost) / currentCost) * 100),
      confidence: 0.7,
      implementation: 'Keep ScalingConfig minVcpu at 1 and adjust idle threshold based on current utilization.',
      risk: 'low',
    });
  }

  // Recommend scheduling if sufficient data
  if (days >= 3 && summary.dataPointCount > 100) {
    const nightCost = calculateMonthlyCost(1);
    const dayCost = calculateMonthlyCost(2);
    const scheduledCost = (nightCost * 10 + dayCost * 14) / 24; // 10h night, 14h day

    recommendations.push({
      type: 'schedule',
      title: 'Time-Based Scheduling',
      description: 'Auto-adjust to 1 vCPU at night (10pm-8am) and 2 vCPU during business hours to optimize costs.',
      currentCost,
      projectedCost: Math.round(scheduledCost * 100) / 100,
      savingsPercent: Math.round(((currentCost - scheduledCost) / currentCost) * 100),
      confidence: 0.6,
      implementation: 'Configure K8s CronJob for time-based vCPU adjustment, or use AWS EventBridge scheduler.',
      risk: 'medium',
    });
  }

  const insight = `Analyzed ${summary.dataPointCount} data points over ${days} days. ` +
    `Average vCPU: ${summary.avgVcpu}, peak: ${summary.peakVcpu}, average CPU utilization: ${summary.avgUtilization.toFixed(1)}%. ` +
    `AI analysis failed — providing default recommendations.`;

  return { recommendations, insight };
}

// ============================================================
// Main Export: Generate Cost Report
// ============================================================

/**
 * Generate cost analysis report
 */
export async function generateCostReport(days: number = 7): Promise<CostReport> {
  // Clamp period
  const effectiveDays = Math.min(Math.max(days, 1), 30);

  // Collect data
  const patterns = await analyzePatterns(effectiveDays);
  const summary = await getUsageSummary(effectiveDays);
  const scalingHistory = await getScalingHistory(50);

  // Calculate current cost
  const currentMonthly = calculateMonthlyCost(summary.avgVcpu);

  // Generate AI recommendations
  const { recommendations, insight } = await getAIRecommendations(
    patterns,
    scalingHistory,
    summary,
    effectiveDays
  );

  // Calculate optimized cost
  const optimizedMonthly = recommendations.length > 0
    ? Math.min(...recommendations.map(r => r.projectedCost))
    : currentMonthly;

  // Calculate total savings percentage
  const totalSavingsPercent = currentMonthly > 0
    ? Math.round(((currentMonthly - optimizedMonthly) / currentMonthly) * 100)
    : 0;

  const savingsAdvice = await generateSavingsAdvice(Math.max(30, effectiveDays));

  // Generate simple UUID
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
    savingsAdvice: savingsAdvice
      ? {
          id: savingsAdvice.id,
          generatedAt: savingsAdvice.generatedAt,
          recommendation: savingsAdvice.recommendation,
          options: savingsAdvice.options.map(option => ({
            name: option.name,
            label: option.label,
            committedVcpu: option.committedVcpu,
            savingsVsOnDemand: option.savingsVsOnDemand,
            savingsPct: option.savingsPct,
            overCommitmentPct: option.overCommitmentPct,
            underCommitmentPct: option.underCommitmentPct,
          })),
        }
      : null,
  };
}
