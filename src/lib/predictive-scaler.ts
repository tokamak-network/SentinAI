/**
 * Predictive Scaler Module
 * AI-powered time-series analysis for preemptive scaling decisions
 *
 * Storage: Redis (if REDIS_URL set) or InMemory (fallback)
 */

import {
  PredictionResult,
  PredictionConfig,
  PredictionFactor,
  DEFAULT_PREDICTION_CONFIG,
} from '@/types/prediction';
import { TargetVcpu } from '@/types/scaling';
import { getRecentMetrics, getMetricsStats, getMetricsCount } from './metrics-store';
import { getStore } from '@/lib/redis-store';
import { chatCompletion } from './ai-client';
import { parseAIJSON } from './ai-response-parser';
import { getChainPlugin } from '@/chains';

// ============================================================================
// Helper Functions for TargetVcpu
// ============================================================================

const VALID_VCPUS: TargetVcpu[] = [1, 2, 4];

/**
 * Get the next higher valid vCPU tier
 */
function nextVcpuUp(current: number): TargetVcpu {
  return VALID_VCPUS.find(v => v > current) ?? 4;
}

/**
 * Get the next lower valid vCPU tier
 */
function nextVcpuDown(current: number): TargetVcpu {
  return [...VALID_VCPUS].reverse().find(v => v < current) ?? 1;
}

/**
 * Build the system prompt for prediction AI
 */
function buildSystemPrompt(): string {
  const plugin = getChainPlugin();
  return `You are an expert Site Reliability Engineer specializing in Kubernetes auto-scaling for ${plugin.displayName} blockchain nodes.

Your task is to analyze time-series metrics and predict the optimal vCPU allocation for the next 5 minutes.

${plugin.aiPrompts.predictiveScalerContext}

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
  "reasoning": "Concise summary under 200 characters. State the key metric trend and recommended action in one sentence.",
  "recommendedAction": "scale_up" | "scale_down" | "maintain",
  "factors": [
    { "name": "factorName", "impact": -1.0 to 1.0, "description": "short phrase" }
  ]
}

IMPORTANT CONSTRAINTS:
- "reasoning" MUST be under 200 characters. Be concise: summarize the core insight, not every detail.
- "description" in factors MUST be under 60 characters each.`;
}

/**
 * Build the user prompt with actual metrics data
 */
async function buildUserPrompt(currentVcpu: number): Promise<string> {
  const metrics = await getRecentMetrics();
  const stats = await getMetricsStats();

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
    const parsed = parseAIJSON<Record<string, unknown>>(content);

    // Validate required fields
    const predictedVcpu = Number(parsed.predictedVcpu);
    const confidence = Number(parsed.confidence);
    if (
      typeof predictedVcpu !== 'number' ||
      ![1, 2, 4].includes(predictedVcpu) ||
      typeof confidence !== 'number' ||
      confidence < 0 ||
      confidence > 1
    ) {
      console.error('Invalid AI response structure:', parsed);
      return null;
    }

    // Ensure factors array is valid
    const factors: PredictionFactor[] = Array.isArray(parsed.factors)
      ? (parsed.factors as unknown[]).map((f: unknown) => {
        const factor = f as Record<string, unknown>;
        return {
          name: String(factor.name || 'unknown'),
          impact: Number(factor.impact) || 0,
          description: String(factor.description || ''),
        };
      })
      : [];

    const trendStr = String(parsed.trend || 'stable');
    const actionStr = String(parsed.recommendedAction || 'maintain');
    return {
      predictedVcpu: predictedVcpu as TargetVcpu,
      confidence,
      trend: ['rising', 'falling', 'stable'].includes(trendStr) ? (trendStr as 'rising' | 'falling' | 'stable') : 'stable',
      reasoning: String(parsed.reasoning || 'No reasoning provided'),
      recommendedAction: ['scale_up', 'scale_down', 'maintain'].includes(actionStr)
        ? (actionStr as 'scale_up' | 'scale_down' | 'maintain')
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
async function generateFallbackPrediction(currentVcpu: number): Promise<PredictionResult> {
  const stats = await getMetricsStats();

  // Simple rule-based fallback
  let predictedVcpu: TargetVcpu = 2; // Default to 2 for safe fallback
  let recommendedAction: 'scale_up' | 'scale_down' | 'maintain' = 'maintain';
  const factors: PredictionFactor[] = [];

  if (stats.stats.cpu.trend === 'rising' && stats.stats.cpu.mean > 50) {
    predictedVcpu = nextVcpuUp(currentVcpu);
    recommendedAction = 'scale_up';
    factors.push({
      name: 'cpuTrend',
      impact: 0.7,
      description: 'CPU trend is rising with high mean usage',
    });
  } else if (stats.stats.cpu.trend === 'falling' && stats.stats.cpu.mean < 30) {
    predictedVcpu = nextVcpuDown(currentVcpu);
    recommendedAction = 'scale_down';
    factors.push({
      name: 'cpuTrend',
      impact: -0.5,
      description: 'CPU trend is falling with low mean usage',
    });
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
  const store = getStore();

  // Check rate limiting
  const now = Date.now();
  const lastPredictionTime = await store.getLastPredictionTime();
  if (now - lastPredictionTime < config.predictionCooldownSeconds * 1000) {
    // Return cached prediction if within cooldown
    return store.getLastPrediction();
  }

  // Check minimum data points
  const dataPointCount = await getMetricsCount();
  if (dataPointCount < config.minDataPoints) {
    console.log(`Insufficient data for prediction: ${dataPointCount}/${config.minDataPoints} points`);
    return null;
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = await buildUserPrompt(currentVcpu);

  try {
    console.log('[Predictive Scaler] Requesting prediction from AI provider...');

    const aiResult = await chatCompletion({
      systemPrompt,
      userPrompt,
      modelTier: 'fast',
      temperature: 0.2,
    });

    const content = aiResult.content || '';

    const prediction = parseAIResponse(content);

    if (prediction) {
      await store.setLastPredictionTime(now);
      await store.setLastPrediction(prediction);
      return prediction;
    }

    // Fall back to rule-based prediction
    console.warn('AI returned invalid response, using fallback prediction');
    const fallback = await generateFallbackPrediction(currentVcpu);
    await store.setLastPredictionTime(now);
    await store.setLastPrediction(fallback);
    return fallback;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Prediction AI provider error:', errorMessage);

    // Fall back to rule-based prediction
    const fallback = await generateFallbackPrediction(currentVcpu);
    await store.setLastPredictionTime(now);
    await store.setLastPrediction(fallback);
    return fallback;
  }
}

/**
 * Get the last prediction without making a new request
 * Useful for displaying in UI
 */
export async function getLastPrediction(): Promise<PredictionResult | null> {
  return getStore().getLastPrediction();
}

/**
 * Check if a new prediction can be made (not rate limited)
 */
export async function canMakePrediction(config: PredictionConfig = DEFAULT_PREDICTION_CONFIG): Promise<boolean> {
  const now = Date.now();
  const lastTime = await getStore().getLastPredictionTime();
  return now - lastTime >= config.predictionCooldownSeconds * 1000;
}

/**
 * Get time until next prediction is allowed (in seconds)
 */
export async function getNextPredictionIn(config: PredictionConfig = DEFAULT_PREDICTION_CONFIG): Promise<number> {
  const now = Date.now();
  const lastTime = await getStore().getLastPredictionTime();
  const elapsed = (now - lastTime) / 1000;
  return Math.max(0, config.predictionCooldownSeconds - elapsed);
}

/**
 * Reset prediction state (for testing)
 */
export async function resetPredictionState(): Promise<void> {
  await getStore().resetPredictionState();
}
