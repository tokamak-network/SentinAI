/**
 * Scaling Accuracy Testing Framework — Type Definitions
 */

import type { MetricDataPoint, PredictionResult } from '@/types/prediction';
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
  /** Optional: mock prediction for predictive scaling test */
  mockPrediction?: PredictionResult | null;
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

/** Predictive backtest result with override statistics */
export interface PredictiveBacktestResult extends BacktestResult {
  /** Accuracy using reactive only */
  reactiveAccuracy: number;
  /** Accuracy using reactive + predictive override */
  combinedAccuracy: number;
  /** Number of overrides triggered */
  overrideCount: number;
  /** Overrides that improved accuracy (wrong → correct) */
  helpfulOverrides: number;
  /** Overrides that worsened accuracy (correct → wrong) */
  harmfulOverrides: number;
}
