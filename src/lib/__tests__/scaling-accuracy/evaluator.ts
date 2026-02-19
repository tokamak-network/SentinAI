/**
 * Scaling Accuracy Testing Framework — Backtest Engine
 *
 * Runs metric sequences through makeScalingDecision() and evaluates accuracy.
 * Supports both reactive-only and reactive+predictive override evaluation.
 * Deterministic — no AI, no mocking required.
 */

import { makeScalingDecision } from '@/lib/scaling-decision';
import type { ScalingMetrics, TargetVcpu } from '@/types/scaling';
import { DEFAULT_PREDICTION_CONFIG } from '@/types/prediction';
import type {
  ScalingScenario,
  BacktestResult,
  StepDecision,
  AccuracySummary,
  PredictiveBacktestResult,
} from './types';

/**
 * Run backtesting for a single scenario.
 * Each step is evaluated independently (no cooldown simulation).
 */
export function backtestScenario(scenario: ScalingScenario): BacktestResult {
  const stepDecisions: StepDecision[] = [];

  for (const step of scenario.steps) {
    const metrics: ScalingMetrics = {
      cpuUsage: step.metrics.cpuUsage,
      txPoolPending: step.metrics.txPoolPending,
      gasUsedRatio: step.metrics.gasUsedRatio,
    };

    const decision = makeScalingDecision(metrics);
    const correct = decision.targetVcpu === step.expectedVcpu;
    const vcpuDelta = decision.targetVcpu - step.expectedVcpu;

    stepDecisions.push({ step, decision, correct, vcpuDelta });
  }

  const correctCount = stepDecisions.filter(s => s.correct).length;

  return {
    scenario: scenario.name,
    totalSteps: scenario.steps.length,
    correctDecisions: correctCount,
    accuracy: (correctCount / scenario.steps.length) * 100,
    stepDecisions,
    underScaleCount: stepDecisions.filter(s => s.vcpuDelta < 0).length,
    overScaleCount: stepDecisions.filter(s => s.vcpuDelta > 0).length,
  };
}

/**
 * Analyze a backtest result and generate recommendations.
 */
export function analyzeResult(result: BacktestResult): string[] {
  const recommendations: string[] = [];

  if (result.accuracy < 70) {
    recommendations.push(
      `WARNING: "${result.scenario}" accuracy ${result.accuracy.toFixed(1)}% (below 70%)`
    );
  }

  if (result.underScaleCount > 0) {
    recommendations.push(
      `Under-scaled ${result.underScaleCount}x in "${result.scenario}" — review idle/normal thresholds`
    );
  }

  if (result.overScaleCount > result.totalSteps * 0.3) {
    recommendations.push(
      `Over-scaled ${result.overScaleCount}/${result.totalSteps} in "${result.scenario}" — consider raising thresholds`
    );
  }

  return recommendations;
}

/**
 * Run all scenarios and produce an accuracy summary.
 */
export function runAllBacktests(scenarios: ScalingScenario[]): AccuracySummary {
  const results = scenarios.map(backtestScenario);
  const totalCorrect = results.reduce((sum, r) => sum + r.correctDecisions, 0);
  const totalSteps = results.reduce((sum, r) => sum + r.totalSteps, 0);

  return {
    scenarios: results,
    overallAccuracy: (totalCorrect / totalSteps) * 100,
    recommendations: results.flatMap(analyzeResult),
  };
}

/**
 * Apply predictive override logic (mirrors agent-loop.ts:322-327).
 * Returns the final vCPU after considering prediction override.
 */
function applyPredictiveOverride(
  reactiveVcpu: TargetVcpu,
  step: ScalingScenario['steps'][number],
): { finalVcpu: TargetVcpu; overrideTriggered: boolean } {
  const prediction = step.mockPrediction;

  if (
    prediction &&
    prediction.confidence >= DEFAULT_PREDICTION_CONFIG.confidenceThreshold &&
    prediction.recommendedAction === 'scale_up' &&
    prediction.predictedVcpu > reactiveVcpu
  ) {
    return { finalVcpu: prediction.predictedVcpu as TargetVcpu, overrideTriggered: true };
  }

  return { finalVcpu: reactiveVcpu, overrideTriggered: false };
}

/**
 * Run predictive backtesting for a scenario.
 * Evaluates both reactive-only and reactive+predictive accuracy.
 */
export function backtestPredictiveScenario(scenario: ScalingScenario): PredictiveBacktestResult {
  const stepDecisions: StepDecision[] = [];
  let reactiveCorrect = 0;
  let combinedCorrect = 0;
  let overrideCount = 0;
  let helpfulOverrides = 0;
  let harmfulOverrides = 0;

  for (const step of scenario.steps) {
    const metrics: ScalingMetrics = {
      cpuUsage: step.metrics.cpuUsage,
      txPoolPending: step.metrics.txPoolPending,
      gasUsedRatio: step.metrics.gasUsedRatio,
    };

    const decision = makeScalingDecision(metrics);
    const reactiveVcpu = decision.targetVcpu;
    const reactiveIsCorrect = reactiveVcpu === step.expectedVcpu;
    if (reactiveIsCorrect) reactiveCorrect++;

    // Apply predictive override
    const { finalVcpu, overrideTriggered } = applyPredictiveOverride(reactiveVcpu, step);
    const combinedIsCorrect = finalVcpu === step.expectedVcpu;
    if (combinedIsCorrect) combinedCorrect++;

    if (overrideTriggered) {
      overrideCount++;
      if (!reactiveIsCorrect && combinedIsCorrect) helpfulOverrides++;
      if (reactiveIsCorrect && !combinedIsCorrect) harmfulOverrides++;
    }

    // StepDecision uses finalVcpu as the decision result
    const vcpuDelta = finalVcpu - step.expectedVcpu;
    stepDecisions.push({
      step,
      decision: { ...decision, targetVcpu: finalVcpu },
      correct: combinedIsCorrect,
      vcpuDelta,
    });
  }

  const totalSteps = scenario.steps.length;

  return {
    scenario: scenario.name,
    totalSteps,
    correctDecisions: combinedCorrect,
    accuracy: (combinedCorrect / totalSteps) * 100,
    stepDecisions,
    underScaleCount: stepDecisions.filter(s => s.vcpuDelta < 0).length,
    overScaleCount: stepDecisions.filter(s => s.vcpuDelta > 0).length,
    reactiveAccuracy: (reactiveCorrect / totalSteps) * 100,
    combinedAccuracy: (combinedCorrect / totalSteps) * 100,
    overrideCount,
    helpfulOverrides,
    harmfulOverrides,
  };
}
