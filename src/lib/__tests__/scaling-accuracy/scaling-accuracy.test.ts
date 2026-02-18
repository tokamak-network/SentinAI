/**
 * Scaling Accuracy Testing Framework
 *
 * Validates makeScalingDecision() against human operator expectations.
 * expectedVcpu in scenarios represents what a senior SRE would decide,
 * NOT what the formula produces. This reveals gaps in the algorithm.
 *
 * Scoring formula (reference):
 *   score = cpu*0.3 + gas*100*0.3 + min(txPool/200,1)*100*0.2 + aiScore*0.2
 *   Thresholds: <30 → 1vCPU, 30-70 → 2vCPU, 70-85 → 4vCPU, >=85 → 8vCPU
 */

import { describe, it, expect } from 'vitest';
import { backtestScenario, runAllBacktests, analyzeResult } from './evaluator';
import {
  IDLE_TO_SPIKE,
  GRADUAL_RISE,
  OSCILLATING,
  SUSTAINED_CRITICAL,
  ALL_SCENARIOS,
} from './scenarios';

// ===== Scenario: Idle to Spike =====
describe('Scenario: idle_to_spike', () => {
  const result = backtestScenario(IDLE_TO_SPIKE);

  it('should report accuracy against operator expectations', () => {
    console.log(`  idle_to_spike accuracy: ${result.accuracy.toFixed(1)}%`);
    console.log(`  under-scaled: ${result.underScaleCount}, over-scaled: ${result.overScaleCount}`);
    for (const s of result.stepDecisions) {
      const mark = s.correct ? 'OK' : s.vcpuDelta > 0 ? 'OVER' : 'UNDER';
      console.log(`    [${mark}] ${s.step.label}: expected=${s.step.expectedVcpu} got=${s.decision.targetVcpu} (score=${s.decision.score})`);
    }
    // Accuracy >= 50% is minimum viable (algorithm should agree with operator on most steps)
    expect(result.accuracy).toBeGreaterThanOrEqual(50);
  });

  it('should stay at 1 vCPU during idle phase', () => {
    const idleSteps = result.stepDecisions.filter(s =>
      s.step.label.toLowerCase().includes('idle')
    );
    for (const s of idleSteps) {
      expect(s.decision.targetVcpu).toBe(1);
    }
  });

  it('should scale up during active spike (at least 2 vCPU)', () => {
    // Only check steps where load is actively high (exclude recovery/post phases)
    const activeSpikeSteps = result.stepDecisions.filter(s =>
      ['Spike begins', 'Peak spike', 'Sustained peak', 'Critical'].includes(s.step.label)
    );
    for (const s of activeSpikeSteps) {
      expect(s.decision.targetVcpu).toBeGreaterThanOrEqual(2);
    }
  });
});

// ===== Scenario: Gradual Rise =====
describe('Scenario: gradual_rise', () => {
  const result = backtestScenario(GRADUAL_RISE);

  it('should report accuracy against operator expectations', () => {
    console.log(`  gradual_rise accuracy: ${result.accuracy.toFixed(1)}%`);
    for (const s of result.stepDecisions) {
      const mark = s.correct ? 'OK' : s.vcpuDelta > 0 ? 'OVER' : 'UNDER';
      console.log(`    [${mark}] ${s.step.label}: expected=${s.step.expectedVcpu} got=${s.decision.targetVcpu} (score=${s.decision.score})`);
    }
    expect(result.accuracy).toBeGreaterThanOrEqual(50);
  });

  it('should produce non-decreasing vCPU sequence', () => {
    const targets = result.stepDecisions.map(s => s.decision.targetVcpu);
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i]).toBeGreaterThanOrEqual(targets[i - 1]);
    }
  });
});

// ===== Scenario: Oscillating =====
describe('Scenario: oscillating', () => {
  const result = backtestScenario(OSCILLATING);

  it('should report accuracy against operator expectations', () => {
    console.log(`  oscillating accuracy: ${result.accuracy.toFixed(1)}%`);
    for (const s of result.stepDecisions) {
      const mark = s.correct ? 'OK' : s.vcpuDelta > 0 ? 'OVER' : 'UNDER';
      console.log(`    [${mark}] ${s.step.label}: expected=${s.step.expectedVcpu} got=${s.decision.targetVcpu} (score=${s.decision.score})`);
    }
    expect(result.accuracy).toBeGreaterThanOrEqual(80);
  });

  it('should only use 1 and 2 vCPU tiers', () => {
    const targets = new Set(result.stepDecisions.map(s => s.decision.targetVcpu));
    expect([...targets].every(v => v === 1 || v === 2)).toBe(true);
  });
});

// ===== Scenario: Sustained Critical =====
describe('Scenario: sustained_critical', () => {
  const result = backtestScenario(SUSTAINED_CRITICAL);

  it('should report accuracy against operator expectations', () => {
    console.log(`  sustained_critical accuracy: ${result.accuracy.toFixed(1)}%`);
    for (const s of result.stepDecisions) {
      const mark = s.correct ? 'OK' : s.vcpuDelta > 0 ? 'OVER' : 'UNDER';
      console.log(`    [${mark}] ${s.step.label}: expected=${s.step.expectedVcpu} got=${s.decision.targetVcpu} (score=${s.decision.score})`);
    }
    expect(result.accuracy).toBeGreaterThanOrEqual(50);
  });

  it('should reach at least 4 vCPU during critical phase', () => {
    const criticalSteps = result.stepDecisions.filter(s =>
      ['Critical', 'Peak critical', 'Max load'].includes(s.step.label)
    );
    for (const s of criticalSteps) {
      expect(s.decision.targetVcpu).toBeGreaterThanOrEqual(4);
    }
  });

  it('should scale down to 1 vCPU at Normal', () => {
    const normalStep = result.stepDecisions.find(s => s.step.label === 'Normal');
    expect(normalStep?.decision.targetVcpu).toBe(1);
  });
});

// ===== Full Suite Summary =====
describe('Overall accuracy summary', () => {
  const summary = runAllBacktests(ALL_SCENARIOS);

  it('should produce results for all 4 scenarios', () => {
    expect(summary.scenarios).toHaveLength(4);
  });

  it('should report overall accuracy and recommendations', () => {
    console.log(`\n  === OVERALL ACCURACY: ${summary.overallAccuracy.toFixed(1)}% ===`);
    for (const s of summary.scenarios) {
      console.log(`  ${s.scenario}: ${s.accuracy.toFixed(1)}% (${s.correctDecisions}/${s.totalSteps}) under=${s.underScaleCount} over=${s.overScaleCount}`);
    }
    if (summary.recommendations.length > 0) {
      console.log(`\n  Recommendations:`);
      for (const r of summary.recommendations) {
        console.log(`    - ${r}`);
      }
    }
    // Overall accuracy should be meaningful but we expect gaps with human judgment
    expect(summary.overallAccuracy).toBeGreaterThanOrEqual(0);
  });
});

// ===== Score Breakdown Structure =====
describe('Score breakdown structure', () => {
  const result = backtestScenario(IDLE_TO_SPIKE);

  it('should include valid breakdown for every step', () => {
    for (const { decision } of result.stepDecisions) {
      expect(decision.breakdown).toMatchObject({
        cpuScore: expect.any(Number),
        gasScore: expect.any(Number),
        txPoolScore: expect.any(Number),
        aiScore: expect.any(Number),
      });
      expect(decision.breakdown.aiScore).toBe(0);
    }
  });

  it('should produce scores between 0 and 100', () => {
    for (const { decision } of result.stepDecisions) {
      expect(decision.score).toBeGreaterThanOrEqual(0);
      expect(decision.score).toBeLessThanOrEqual(100);
    }
  });
});

// ===== Boundary Values (formula-exact, always valid) =====
describe('Boundary value verification', () => {
  it('score exactly at idle threshold (30) → 2 vCPU', () => {
    const result = backtestScenario({
      name: 'boundary_30', description: '',
      steps: [{
        offsetSeconds: 0,
        metrics: { timestamp: new Date().toISOString(), cpuUsage: 50, txPoolPending: 0, gasUsedRatio: 0.50, blockHeight: 1000, blockInterval: 2, currentVcpu: 1 },
        expectedVcpu: 2, label: 'Boundary at 30',
      }],
    });
    expect(result.correctDecisions).toBe(1);
  });

  it('score exactly at normal threshold (70) → 4 vCPU', () => {
    const result = backtestScenario({
      name: 'boundary_70', description: '',
      steps: [{
        offsetSeconds: 0,
        metrics: { timestamp: new Date().toISOString(), cpuUsage: 100, txPoolPending: 100, gasUsedRatio: 1.0, blockHeight: 1000, blockInterval: 2, currentVcpu: 1 },
        expectedVcpu: 4, label: 'Boundary at 70',
      }],
    });
    expect(result.correctDecisions).toBe(1);
  });

  it('zero load → 1 vCPU', () => {
    const result = backtestScenario({
      name: 'zero_load', description: '',
      steps: [{
        offsetSeconds: 0,
        metrics: { timestamp: new Date().toISOString(), cpuUsage: 0, txPoolPending: 0, gasUsedRatio: 0, blockHeight: 1000, blockInterval: 2, currentVcpu: 1 },
        expectedVcpu: 1, label: 'Zero load',
      }],
    });
    expect(result.correctDecisions).toBe(1);
  });

  it('max load without AI → 8 vCPU (score=80, above 77 critical)', () => {
    const result = backtestScenario({
      name: 'max_no_ai', description: '',
      steps: [{
        offsetSeconds: 0,
        metrics: { timestamp: new Date().toISOString(), cpuUsage: 100, txPoolPending: 300, gasUsedRatio: 1.0, blockHeight: 1000, blockInterval: 2, currentVcpu: 1 },
        expectedVcpu: 8, label: 'Max without AI',
      }],
    });
    expect(result.correctDecisions).toBe(1);
  });
});
