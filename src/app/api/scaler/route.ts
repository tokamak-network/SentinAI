/**
 * Scaler API Endpoint
 * GET: Get current scaling state
 * POST: Trigger manual scaling or execute auto-scaling
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  makeScalingDecision,
  mapAIResultToSeverity,
} from '@/lib/scaling-decision';
import {
  scaleOpGeth,
  getScalingState,
  addScalingHistory,
  isAutoScalingEnabled,
  setAutoScalingEnabled,
  getCurrentVcpu,
  updateScalingState,
  isSimulationMode,
  setSimulationMode,
} from '@/lib/k8s-scaler';
import {
  ScalerRequest,
  ScalerResponse,
  ScalingMetrics,
  TargetVcpu,
  DEFAULT_SCALING_CONFIG,
} from '@/types/scaling';
import { predictScaling, getLastPrediction, getNextPredictionIn } from '@/lib/predictive-scaler';
import { getMetricsCount } from '@/lib/metrics-store';
import { PredictionResult, DEFAULT_PREDICTION_CONFIG } from '@/types/prediction';

/**
 * Get current metrics from /api/metrics
 */
async function fetchCurrentMetrics(baseUrl: string): Promise<{
  cpuUsage: number;
  txPoolPending: number;
  gasUsedRatio: number;
} | null> {
  try {
    const res = await fetch(`${baseUrl}/api/metrics`, {
      cache: 'no-store',
    });

    if (!res.ok) return null;

    const data = await res.json();
    return {
      cpuUsage: data.metrics?.cpuUsage || 0,
      txPoolPending: data.metrics?.txPoolCount || 0,
      // gasUsedRatio is not directly provided, so cpuUsage is used as a proxy
      gasUsedRatio: (data.metrics?.cpuUsage || 0) / 100,
    };
  } catch (error) {
    console.error('Failed to fetch metrics:', error);
    return null;
  }
}

/**
 * Get AI analysis results from /api/analyze-logs
 */
async function fetchAIAnalysis(baseUrl: string): Promise<{
  severity: string;
} | null> {
  try {
    const res = await fetch(`${baseUrl}/api/analyze-logs?mode=live`, {
      cache: 'no-store',
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.analysis || null;
  } catch (error) {
    console.error('Failed to fetch AI analysis:', error);
    return null;
  }
}

/**
 * GET: Get current scaling state with prediction
 */
export async function GET(_request: NextRequest) {
  try {
    const state = getScalingState();
    const currentVcpu = await getCurrentVcpu();

    // Sync with actual K8s state
    if (currentVcpu !== state.currentVcpu) {
      updateScalingState({
        currentVcpu,
        currentMemoryGiB: (currentVcpu * 2) as 2 | 4 | 8,
      });
    }

    // Get or generate prediction
    let prediction: PredictionResult | null = getLastPrediction();
    const metricsCount = getMetricsCount();

    // Try to generate new prediction if we have enough data
    if (metricsCount >= DEFAULT_PREDICTION_CONFIG.minDataPoints) {
      const newPrediction = await predictScaling(currentVcpu);
      if (newPrediction) {
        prediction = newPrediction;
      }
    }

    // Build prediction info for response
    const predictionInfo = prediction
      ? {
          predictedVcpu: prediction.predictedVcpu,
          confidence: prediction.confidence,
          trend: prediction.trend,
          reasoning: prediction.reasoning,
          recommendedAction: prediction.recommendedAction,
          generatedAt: prediction.generatedAt,
          predictionWindow: prediction.predictionWindow,
          factors: prediction.factors,
        }
      : null;

    return NextResponse.json({
      ...getScalingState(),
      simulationMode: isSimulationMode(),
      timestamp: new Date().toISOString(),
      // New prediction fields
      prediction: predictionInfo,
      predictionMeta: {
        metricsCount,
        minRequired: DEFAULT_PREDICTION_CONFIG.minDataPoints,
        nextPredictionIn: getNextPredictionIn(),
        isReady: metricsCount >= DEFAULT_PREDICTION_CONFIG.minDataPoints,
      },
    });
  } catch (error) {
    console.error('GET /api/scaler error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to get scaling state', message },
      { status: 500 }
    );
  }
}

/**
 * POST: Execute scaling
 */
export async function POST(request: NextRequest) {
  try {
    const body: ScalerRequest = await request.json().catch(() => ({}));
    const { targetVcpu: manualTarget, reason: manualReason, dryRun } = body;

    // Extract base URL (In Vercel environment)
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';

    let decision;
    let triggeredBy: 'auto' | 'manual' = 'auto';

    if (manualTarget !== undefined) {
      // Manual Scaling
      triggeredBy = 'manual';
      const validTargets: TargetVcpu[] = [1, 2, 4];
      if (!validTargets.includes(manualTarget as TargetVcpu)) {
        return NextResponse.json(
          { error: 'Invalid targetVcpu. Must be 1, 2, or 4' },
          { status: 400 }
        );
      }

      decision = {
        targetVcpu: manualTarget as TargetVcpu,
        targetMemoryGiB: (manualTarget * 2) as 2 | 4 | 8,
        reason: manualReason || 'Manual scaling request',
        confidence: 1,
        score: 0,
        breakdown: { cpuScore: 0, gasScore: 0, txPoolScore: 0, aiScore: 0 },
      };
    } else {
      // Auto-scaling (with optional predictive mode)
      if (!isAutoScalingEnabled()) {
        return NextResponse.json(
          { error: 'Auto-scaling is disabled', autoScalingEnabled: false },
          { status: 400 }
        );
      }

      // Collect metrics
      const metrics = await fetchCurrentMetrics(baseUrl);
      if (!metrics) {
        return NextResponse.json(
          { error: 'Failed to fetch metrics' },
          { status: 500 }
        );
      }

      // AI Analysis (Optional - Continue even if failed)
      const aiAnalysis = await fetchAIAnalysis(baseUrl);
      const aiSeverity = mapAIResultToSeverity(aiAnalysis);

      // Scaling Decision
      const scalingMetrics: ScalingMetrics = {
        ...metrics,
        aiSeverity,
      };

      // Get reactive decision
      const reactiveDecision = makeScalingDecision(scalingMetrics);

      // Try predictive scaling for preemptive action
      const currentVcpu = await getCurrentVcpu();
      const prediction = await predictScaling(currentVcpu);

      // Use predictive decision if confidence is high enough and it suggests scaling up
      if (
        prediction &&
        prediction.confidence >= DEFAULT_PREDICTION_CONFIG.confidenceThreshold &&
        prediction.recommendedAction === 'scale_up' &&
        prediction.predictedVcpu > reactiveDecision.targetVcpu
      ) {
        // Preemptive scaling based on prediction
        decision = {
          targetVcpu: prediction.predictedVcpu,
          targetMemoryGiB: (prediction.predictedVcpu * 2) as 2 | 4 | 8,
          reason: `[Predictive] ${prediction.reasoning} (Confidence: ${(prediction.confidence * 100).toFixed(0)}%)`,
          confidence: prediction.confidence,
          score: reactiveDecision.score,
          breakdown: reactiveDecision.breakdown,
        };
        triggeredBy = 'auto';
        console.log(`[Predictive Scaler] Preemptive scale-up: ${currentVcpu} -> ${prediction.predictedVcpu} vCPU`);
      } else {
        // Use reactive decision
        decision = reactiveDecision;
      }
    }

    // Execute Scaling
    const result = await scaleOpGeth(
      decision.targetVcpu,
      decision.targetMemoryGiB,
      DEFAULT_SCALING_CONFIG,
      dryRun
    );

    // Add history (Only when not dry run and actual change occurred)
    if (!dryRun && result.success && result.previousVcpu !== result.currentVcpu) {
      addScalingHistory({
        timestamp: result.timestamp,
        fromVcpu: result.previousVcpu,
        toVcpu: result.currentVcpu,
        reason: decision.reason,
        triggeredBy,
        decision,
      });
    }

    const response: ScalerResponse = {
      success: result.success,
      previousVcpu: result.previousVcpu,
      currentVcpu: result.currentVcpu,
      decision,
      cooldownRemaining: getScalingState().cooldownRemaining,
      dryRun,
      error: result.error,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('POST /api/scaler error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Scaling failed', message },
      { status: 500 }
    );
  }
}

/**
 * PATCH: Update auto-scaling settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { autoScalingEnabled, simulationMode } = body;

    if (typeof autoScalingEnabled === 'boolean') {
      setAutoScalingEnabled(autoScalingEnabled);
    }

    if (typeof simulationMode === 'boolean') {
      setSimulationMode(simulationMode);
    }

    return NextResponse.json({
      success: true,
      autoScalingEnabled: isAutoScalingEnabled(),
      simulationMode: isSimulationMode(),
    });
  } catch (error) {
    console.error('PATCH /api/scaler error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to update settings', message },
      { status: 500 }
    );
  }
}
