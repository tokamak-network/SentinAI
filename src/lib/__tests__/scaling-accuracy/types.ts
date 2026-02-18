/**
 * Scaling Accuracy Testing Framework — Type Definitions
 */

import type { MetricDataPoint } from '@/types/prediction';
import type { ScalingDecision, TargetVcpu } from '@/types/scaling';

/** A single step in a test scenario */
export interface ScenarioStep {
  /** Time offset in seconds from scenario start */
  offsetSeconds: number;
  /** Metric values at this time step */
  metrics: MetricDataPoint;
  /** Expected correct vCPU decision (ground truth) */
  expectedVcpu: TargetVcpu;
  /** Human-readable label */
  label: string;
}

/** A complete metric sequence scenario */
export interface ScalingScenario {
  name: string;
  description: string;
  steps: ScenarioStep[];
}

/** Decision made at a single step */
export interface StepDecision {
  step: ScenarioStep;
  decision: ScalingDecision;
  correct: boolean;
  /** decision.targetVcpu - step.expectedVcpu */
  vcpuDelta: number;
}

/** Full backtesting result for one scenario */
export interface BacktestResult {
  scenario: string;
  totalSteps: number;
  correctDecisions: number;
  accuracy: number;
  stepDecisions: StepDecision[];
  underScaleCount: number;
  overScaleCount: number;
}

/** Summary of all backtest results */
export interface AccuracySummary {
  scenarios: BacktestResult[];
  overallAccuracy: number;
  recommendations: string[];
}
