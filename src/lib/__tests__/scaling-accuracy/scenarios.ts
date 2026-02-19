/**
 * Scaling Accuracy Testing Framework — Predefined Metric Sequences
 *
 * expectedVcpu is set by human operator judgment, NOT computed from the formula.
 * This allows measuring whether the algorithm's weight/threshold config
 * aligns with what a senior SRE would actually decide.
 *
 * Scoring formula (for reference):
 *   score = cpu*0.3 + gasRatio*100*0.3 + min(txPool/200,1)*100*0.2 + aiScore*0.2
 *   Thresholds: <30 → 1vCPU, 30-70 → 2vCPU, 70-85 → 4vCPU, >=85 → 8vCPU
 */

import type { ScalingScenario } from './types';
import type { MetricDataPoint, PredictionResult } from '@/types/prediction';

function makePoint(
  offsetSeconds: number,
  cpu: number,
  txPool: number,
  gasRatio: number,
  vcpu: number = 1,
): MetricDataPoint {
  const base = Date.now();
  return {
    timestamp: new Date(base + offsetSeconds * 1000).toISOString(),
    cpuUsage: cpu,
    txPoolPending: txPool,
    gasUsedRatio: gasRatio,
    blockHeight: 1_000_000 + Math.floor(offsetSeconds / 2),
    blockInterval: 2.0,
    currentVcpu: vcpu,
  };
}

// ---- Scenario 1: Idle → Spike → Recovery ----
// Operator expectation: scale up aggressively on spike, don't wait for score=85

export const IDLE_TO_SPIKE: ScalingScenario = {
  name: 'idle_to_spike',
  description: 'System starts idle then experiences sudden load spike',
  steps: [
    // CPU 10%, Gas 5%, TxPool 20 — clearly idle
    { offsetSeconds: 0,   metrics: makePoint(0,   10, 20,  0.05), expectedVcpu: 1, label: 'Idle baseline' },
    // CPU 12%, Gas 6%, TxPool 25 — still idle
    { offsetSeconds: 30,  metrics: makePoint(30,  12, 25,  0.06), expectedVcpu: 1, label: 'Idle' },
    // CPU 80%, Gas 85%, TxPool 180 — sudden spike, operator wants 4 vCPU
    { offsetSeconds: 60,  metrics: makePoint(60,  80, 180, 0.85), expectedVcpu: 4, label: 'Spike begins' },
    // CPU 92%, Gas 95%, TxPool 300 — peak, operator wants 4 vCPU
    { offsetSeconds: 90,  metrics: makePoint(90,  92, 300, 0.95), expectedVcpu: 4, label: 'Peak spike' },
    // CPU 95%, Gas 98%, TxPool 350 — sustained, operator wants 8 vCPU emergency
    { offsetSeconds: 120, metrics: makePoint(120, 95, 350, 0.98), expectedVcpu: 8, label: 'Sustained peak' },
    // CPU 98%, Gas 99%, TxPool 400 — critical, operator wants 8 vCPU
    { offsetSeconds: 150, metrics: makePoint(150, 98, 400, 0.99), expectedVcpu: 8, label: 'Critical' },
    // CPU 40%, Gas 30%, TxPool 50 — recovering, can go back to 2 vCPU
    { offsetSeconds: 180, metrics: makePoint(180, 40, 50,  0.30), expectedVcpu: 2, label: 'Recovery' },
    // CPU 8%, Gas 5%, TxPool 10 — back to idle
    { offsetSeconds: 210, metrics: makePoint(210, 8,  10,  0.05), expectedVcpu: 1, label: 'Post-spike idle' },
  ],
};

// ---- Scenario 2: Gradual Rise ----
// Operator expectation: start scaling at moderate load, hit 4 vCPU when clearly high

export const GRADUAL_RISE: ScalingScenario = {
  name: 'gradual_rise',
  description: 'Load gradually increases over time',
  steps: [
    // CPU 10%, Gas 10%, TxPool 20 — low
    { offsetSeconds: 0,   metrics: makePoint(0,   10, 20,  0.10), expectedVcpu: 1, label: 'Low load' },
    // CPU 25%, Gas 25%, TxPool 50 — still low
    { offsetSeconds: 60,  metrics: makePoint(60,  25, 50,  0.25), expectedVcpu: 1, label: 'Mild increase' },
    // CPU 40%, Gas 40%, TxPool 80 — moderate, should start scaling
    { offsetSeconds: 120, metrics: makePoint(120, 40, 80,  0.40), expectedVcpu: 2, label: 'Normal load begins' },
    // CPU 55%, Gas 55%, TxPool 110 — normal load
    { offsetSeconds: 180, metrics: makePoint(180, 55, 110, 0.55), expectedVcpu: 2, label: 'Normal load' },
    // CPU 70%, Gas 70%, TxPool 150 — approaching high, operator still ok with 2 vCPU
    { offsetSeconds: 240, metrics: makePoint(240, 70, 150, 0.70), expectedVcpu: 2, label: 'Approaching high' },
    // CPU 85%, Gas 85%, TxPool 200 — high, operator wants 4 vCPU
    { offsetSeconds: 300, metrics: makePoint(300, 85, 200, 0.85), expectedVcpu: 4, label: 'High load' },
    // CPU 95%, Gas 95%, TxPool 250 — very high, operator wants 8 vCPU
    { offsetSeconds: 360, metrics: makePoint(360, 95, 250, 0.95), expectedVcpu: 8, label: 'Peak high' },
  ],
};

// ---- Scenario 3: Oscillating Load ----
// Operator expectation: stable switching between 1 and 2, no over-provisioning

export const OSCILLATING: ScalingScenario = {
  name: 'oscillating',
  description: 'Load oscillates between low and medium',
  steps: [
    // CPU 15%, Gas 15%, TxPool 30 — low
    { offsetSeconds: 0,   metrics: makePoint(0,   15, 30,  0.15), expectedVcpu: 1, label: 'Low' },
    // CPU 50%, Gas 55%, TxPool 100 — medium
    { offsetSeconds: 60,  metrics: makePoint(60,  50, 100, 0.55), expectedVcpu: 2, label: 'Medium' },
    // CPU 12%, Gas 12%, TxPool 20 — low
    { offsetSeconds: 120, metrics: makePoint(120, 12, 20,  0.12), expectedVcpu: 1, label: 'Low' },
    // CPU 52%, Gas 58%, TxPool 105 — medium
    { offsetSeconds: 180, metrics: makePoint(180, 52, 105, 0.58), expectedVcpu: 2, label: 'Medium' },
    // CPU 10%, Gas 10%, TxPool 15 — low
    { offsetSeconds: 240, metrics: makePoint(240, 10, 15,  0.10), expectedVcpu: 1, label: 'Low' },
    // CPU 48%, Gas 52%, TxPool 95 — medium
    { offsetSeconds: 300, metrics: makePoint(300, 48, 95,  0.52), expectedVcpu: 2, label: 'Medium' },
  ],
};

// ---- Scenario 4: Sustained Critical ----
// Operator expectation: must hit 8 vCPU for sustained high load, scale down cleanly

export const SUSTAINED_CRITICAL: ScalingScenario = {
  name: 'sustained_critical',
  description: 'System under critical load then recovers',
  steps: [
    // CPU 95%, Gas 95%, TxPool 280 — operator wants 8 vCPU (this is critical)
    { offsetSeconds: 0,   metrics: makePoint(0,   95, 280, 0.95), expectedVcpu: 8, label: 'Critical' },
    // CPU 98%, Gas 98%, TxPool 350 — definitely 8 vCPU
    { offsetSeconds: 60,  metrics: makePoint(60,  98, 350, 0.98), expectedVcpu: 8, label: 'Peak critical' },
    // CPU 100%, Gas 100%, TxPool 400 — max, emergency
    { offsetSeconds: 120, metrics: makePoint(120, 100, 400, 1.00), expectedVcpu: 8, label: 'Max load' },
    // CPU 60%, Gas 60%, TxPool 150 — cooling, 2 vCPU sufficient
    { offsetSeconds: 180, metrics: makePoint(180, 60, 150, 0.60), expectedVcpu: 2, label: 'Cooling down' },
    // CPU 30%, Gas 30%, TxPool 40 — recovering
    { offsetSeconds: 240, metrics: makePoint(240, 30, 40,  0.30), expectedVcpu: 1, label: 'Recovering' },
    // CPU 8%, Gas 5%, TxPool 10 — normal
    { offsetSeconds: 300, metrics: makePoint(300, 8,  10,  0.05), expectedVcpu: 1, label: 'Normal' },
  ],
};

/** All reactive-only scenarios for full backtesting */
export const ALL_SCENARIOS: ScalingScenario[] = [
  IDLE_TO_SPIKE,
  GRADUAL_RISE,
  OSCILLATING,
  SUSTAINED_CRITICAL,
];

// ==================== Predictive Scenarios ====================

/** Helper: create a mock PredictionResult */
export function makePrediction(
  predictedVcpu: 1 | 2 | 4,
  confidence: number,
  action: 'scale_up' | 'scale_down' | 'maintain',
  trend: 'rising' | 'falling' | 'stable' = 'stable',
): PredictionResult {
  return {
    predictedVcpu,
    confidence,
    trend,
    reasoning: `Mock prediction: ${action} to ${predictedVcpu} vCPU`,
    recommendedAction: action,
    generatedAt: new Date().toISOString(),
    predictionWindow: 'next 5 minutes',
    factors: [{ name: 'test', impact: confidence, description: 'test factor' }],
  };
}

// ---- Predictive Scenario 1: Spike Rescue ----
// Prediction compensates for reactive under-scaling during sudden spike.
// Key: "Spike begins" reactive=2 vCPU (score=65), prediction overrides to 4 vCPU.

export const PREDICTIVE_SPIKE_RESCUE: ScalingScenario = {
  name: 'predictive_spike_rescue',
  description: 'Prediction rescues under-scaling during sudden spike',
  steps: [
    // Idle — no prediction needed
    { offsetSeconds: 0,   metrics: makePoint(0,   10, 20,  0.05), expectedVcpu: 1, label: 'Idle baseline' },
    // Idle — AI detects no trend
    { offsetSeconds: 30,  metrics: makePoint(30,  12, 25,  0.06), expectedVcpu: 1, label: 'Idle',
      mockPrediction: makePrediction(1, 0.80, 'maintain', 'stable') },
    // Spike begins — reactive=2 (score=65), prediction overrides to 4
    { offsetSeconds: 60,  metrics: makePoint(60,  80, 180, 0.85), expectedVcpu: 4, label: 'Spike begins',
      mockPrediction: makePrediction(4, 0.88, 'scale_up', 'rising') },
    // Peak — reactive=4, prediction also says 4 (no override needed)
    { offsetSeconds: 90,  metrics: makePoint(90,  92, 300, 0.95), expectedVcpu: 4, label: 'Peak spike',
      mockPrediction: makePrediction(4, 0.82, 'maintain', 'rising') },
    // Sustained — reactive=8, no prediction override (only scale_up overrides)
    { offsetSeconds: 120, metrics: makePoint(120, 95, 350, 0.98), expectedVcpu: 8, label: 'Sustained peak',
      mockPrediction: makePrediction(4, 0.75, 'maintain', 'stable') },
    // Critical — reactive=8, prediction confirms
    { offsetSeconds: 150, metrics: makePoint(150, 98, 400, 0.99), expectedVcpu: 8, label: 'Critical' },
    // Recovery — reactive=2, prediction says scale_down (ignored: not scale_up)
    { offsetSeconds: 180, metrics: makePoint(180, 40, 50,  0.30), expectedVcpu: 2, label: 'Recovery',
      mockPrediction: makePrediction(1, 0.90, 'scale_down', 'falling') },
    // Post-spike — back to idle
    { offsetSeconds: 210, metrics: makePoint(210, 8,  10,  0.05), expectedVcpu: 1, label: 'Post-spike idle' },
  ],
};

// ---- Predictive Scenario 2: False Alarm ----
// AI recommends scale_up but confidence is too low — should be ignored.
// All steps should match reactive-only result.

export const PREDICTIVE_FALSE_ALARM: ScalingScenario = {
  name: 'predictive_false_alarm',
  description: 'Low-confidence predictions correctly ignored',
  steps: [
    // Normal load — AI says scale_up but confidence=0.55 (below 0.7 threshold)
    { offsetSeconds: 0,   metrics: makePoint(0,   40, 80,  0.40), expectedVcpu: 2, label: 'Normal load',
      mockPrediction: makePrediction(4, 0.55, 'scale_up', 'rising') },
    // Brief spike — confidence=0.65, still below threshold
    { offsetSeconds: 60,  metrics: makePoint(60,  55, 120, 0.55), expectedVcpu: 2, label: 'Brief spike',
      mockPrediction: makePrediction(4, 0.65, 'scale_up', 'rising') },
    // Load drops — prediction says maintain
    { offsetSeconds: 120, metrics: makePoint(120, 35, 60,  0.35), expectedVcpu: 2, label: 'Settling',
      mockPrediction: makePrediction(2, 0.80, 'maintain', 'falling') },
    // Back to low — no prediction
    { offsetSeconds: 180, metrics: makePoint(180, 15, 30,  0.15), expectedVcpu: 1, label: 'Low load' },
    // Low again — prediction says scale_up but predictedVcpu <= reactive (no override)
    { offsetSeconds: 240, metrics: makePoint(240, 45, 90,  0.45), expectedVcpu: 2, label: 'Moderate',
      mockPrediction: makePrediction(2, 0.85, 'scale_up', 'rising') },
  ],
};

/** All predictive scenarios */
export const ALL_PREDICTIVE_SCENARIOS: ScalingScenario[] = [
  PREDICTIVE_SPIKE_RESCUE,
  PREDICTIVE_FALSE_ALARM,
];
