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

// Anthropic API Configuration
const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

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
        'Authorization': `Bearer ${ANTHROPIC_API_KEY}`,
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
