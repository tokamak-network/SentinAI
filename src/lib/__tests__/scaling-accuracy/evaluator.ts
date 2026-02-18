/**
 * Scaling Accuracy Testing Framework — Backtest Engine
 *
 * Runs metric sequences through makeScalingDecision() and evaluates accuracy.
 * Deterministic — no AI, no mocking required.
 */

import { makeScalingDecision } from '@/lib/scaling-decision';
import type { ScalingMetrics } from '@/types/scaling';
import type {
  ScalingScenario,
  BacktestResult,
  StepDecision,
  AccuracySummary,
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
