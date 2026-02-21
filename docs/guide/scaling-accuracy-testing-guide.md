# Scaling Accuracy Testing Framework Guide

A backtesting framework to measure how well SentinAI's scaling algorithms (reactive + predictive) match actual operator expectations.

---

## Principle

### What do we measure?

This framework answers three questions:

1. **Code Correctness**: Are the scaling formulas calculated as designed? (`scaling-decision.test.ts`)
2. **Responsive judgment accuracy**: Do the weights/thresholds in the formula match the senior SRE’s judgment?
3. **Predictive improvement effect**: Does predictive override compensate for the weaknesses of reactive?

### Test classification

| | unit testing | Responsive Backtest | Predictive Backtest |
|---|---|---|---|
| **파일** | `scaling-decision.test.ts` | `scaling-accuracy/` | `scaling-accuracy/` |
| **Standard** | Code Design Specification | Operator judgment | Operator judgment |
| **Function** | Individual function verification | `backtestScenario()` | `backtestPredictiveScenario()` |
| **Failure Meaning** | bug | Weights/thresholds need adjustment | Override conditions need to be adjusted |
| **AI Required** | Not necessary | Not necessary | Unnecessary (mock prediction) |

### Scaling formula (reference)

```
score = cpu * 0.3 + gas * 100 * 0.3 + min(txPool/200, 1) * 100 * 0.2 + aiScore * 0.2
```

| Score range | Tier | vCPU | memory |
|-----------|------|------|--------|
| < 30 | Idle | 1 | 2 GiB |
| 30 ~ 70 | Normal | 2 | 4 GiB |
| 70 ~ 77 | High | 4 | 8 GiB |
| >= 77 | Critical | 8 | 16 GiB |

> **Note**: Maximum score without AI severity is 80 (CPU 30 + Gas 30 + TxPool 20). Critical threshold is 77, so 8 vCPU can be reached without AI.

### Predictive override condition

```
Conditions for override to trigger (all must be met):
1. prediction.confidence >= 0.7 (70%)
2. prediction.recommendedAction === 'scale_up' (스케일업만)
3. prediction.predictedVcpu > reactiveVcpu (higher vCPU)
```

In other words, predictive type only allows **proactive scale-up**. Recommendations to scale down or maintain are ignored.

---

## Architecture

```
scaling-accuracy/
├── types.ts                    # 타입 (ScenarioStep, BacktestResult, PredictiveBacktestResult)
├── scenarios.ts # 6 metric sequences (responsive 4 + predictive 2)
├── evaluator.ts # Backtest engine (backtestScenario, backtestPredictiveScenario)
└── scaling-accuracy.test.ts # Vitest test suite (29)
```

### Responsive behavior

```
scenarios.ts          evaluator.ts              scaling-decision.ts
┌─────────────┐      ┌──────────────────┐      ┌─────────────────┐
│ Scenario │ │ backtestScenario │ │ makeScaling │
│ [step1]     │─────▶│   for each step: │─────▶│   Decision()    │
│ [step2] │ │ metrics → │ │ score calculation │
│ [step3] │ │ decision = │◀─────│ vCPU decision │
│ ...         │      │     compare with │      └─────────────────┘
│ expectedVcpu│      │     expectedVcpu │
└─────────────┘      │                  │
│ Result: │
                     │   accuracy %     │
                     │   under/over cnt │
                     └──────────────────┘
```

### Predictive behavior

```
scenarios.ts          evaluator.ts                           scaling-decision.ts
┌──────────────┐     ┌──────────────────────────┐           ┌─────────────────┐
│ Scenario │ │ backtestPredictiveScenario│ │ makeScaling │
│ [step]       │────▶│   1. reactive decision ───│──────────▶│   Decision()    │
│  metrics     │     │   2. override check:      │◀──────────│   score → vCPU  │
│  mockPredict │     │      conf >= 0.7?         │           └─────────────────┘
│  expectedVcpu│     │      action == scale_up?  │
└──────────────┘     │      predicted > reactive?│
                     │   3. final = override or  │
                     │      reactive             │
                     │   4. compare expectedVcpu │
                     │                           │
│ Result: │
                     │   reactiveAccuracy        │
                     │   combinedAccuracy        │
                     │   overrideCount           │
                     │   helpful / harmful       │
                     └──────────────────────────┘
```

1. Extract metrics from each step of the scenario
2. Collect responsive results by passing them to `makeScalingDecision()`
3. If there is `mockPrediction`, check the override condition → Use the predicted vCPU when the condition is met.
4. Compare final `targetVcpu` with operator expected `expectedVcpu`
5. Simultaneous calculation of responsive accuracy / combined accuracy / override statistics

---

## Responsive scenarios (4)

### 1. `idle_to_spike` — idle → sudden spike → recovery

A pattern that suddenly soars to 95% CPU and 400 TxPool in a low load state and then stabilizes again.

| steps | CPU | Gas | TxPool | operator expectations | Verification target |
|------|-----|-----|--------|------------|-----------|
| Idle baseline | 10% | 5% | 20 | 1 vCPU | Prevent over-provisioning at rest |
| Spike begins | 80% | 85% | 180 | 4 vCPUs | Spike Detection Rate |
| Peak spike | 92% | 95% | 300 | 4 vCPUs | Gradual scale-up |
| Sustained peak | 95% | 98% | 350 | 8 vCPUs | Continuous high load → emergency mode |
| Critical | 98% | 99% | 400 | 8 vCPUs | Maintain maximum tier |
| Recovery | 40% | 30% | 50 | 2 vCPUs | scale down |
| Post-spike idle | 8% | 5% | 10 | 1 vCPU | Full return |

### 2. `gradual_rise` — Gradual load increase

A pattern in which the load slowly increases, crossing each threshold boundary one by one.

| steps | CPU | Gas | TxPool | operator expectations | Verification target |
|------|-----|-----|--------|------------|-----------|
| Low load | 10% | 10% | 20 | 1 vCPU | Maintain low load |
| Normal load begins | 40% | 40% | 80 | 2 vCPUs | Normal threshold detection |
| Approaching high | 70% | 70% | 150 | 2 vCPUs | Avoid unnecessary early scale-up |
| High load | 85% | 85% | 200 | 4 vCPUs | Enter High Tier |
| Peak high | 95% | 95% | 250 | 8 vCPUs | Entering Critical Tier |

### 3. `oscillating` — Oscillating pattern (low ↔ medium)

A pattern that requires only 1 to 2 vCPUs to be used stably, repeating low and medium loads.

| steps | CPU | Gas | TxPool | operator expectations | Verification target |
|------|-----|-----|--------|------------|-----------|
| Low | 15% | 15% | 30 | 1 vCPU | Maintain stability |
| Medium | 50% | 55% | 100 | 2 vCPUs | Appropriate scale-up |
| Low | 12% | 12% | 20 | 1 vCPU | scale down |
| Medium | 52% | 58% | 105 | 2 vCPUs | stable repetition |

> Bottom line: **Fail** when you go above 4 vCPU — over-provisioning.

### 4. `sustained_critical` — Sustained high load → recovery

A pattern that scales down cleanly after an extreme load continues.

| steps | CPU | Gas | TxPool | operator expectations | Verification target |
|------|-----|-----|--------|------------|-----------|
| Critical | 95% | 95% | 280 | 8 vCPUs | Instant Max Tier |
| Max load | 100% | 100% | 400 | 8 vCPUs | Maintenance |
| Cooling down | 60% | 60% | 150 | 2 vCPUs | Appropriate scale down |
| Normal | 8% | 5% | 10 | 1 vCPU | lowest return |

---

## Predictive scenarios (2)

### 5. `predictive_spike_rescue` — Predictive compensation for under-scaling

At the start of the spike, where reactive determines 2 vCPU with score=65, AI prediction (confidence=0.88, scale_up) overrides it with 4 vCPU.

| steps | CPU | Responsive | prediction (mock) | Override | operator expectations |
|------|-----|--------|------------|-----------|------------|
| Idle baseline | 10% | 1 | — | — | 1 |
| Idle | 12% | 1 | maintain (0.80) | ❌ | 1 |
| Spike begins | 80% | 2 | **scale_up 4 (0.88)** | **✅** | **4** |
| Peak spike | 92% | 4 | maintain (0.82) | ❌ | 4 |
| Sustained peak | 95% | 8 | maintain (0.75) | ❌ | 8 |
| Critical | 98% | 8 | — | — | 8 |
| Recovery | 40% | 1 | scale_down (0.90) | ❌ (action≠scale_up) | 1 |
| Post-spike idle | 8% | 1 | — | — | 1 |

**Result**: reactive 75.0% → combined **87.5%** (+12.5%p, helpful override once)

### 6. `predictive_false_alarm` — Ignore low confidence predictions

AI recommends scale_up, but because confidence < 0.7, override is not activated. Maintain responsive results.

| steps | CPU | Responsive | prediction (mock) | Override | operator expectations |
|------|-----|--------|------------|-----------|------------|
| Normal load | 40% | 2 | scale_up 4 (0.55) | ❌ (conf < 0.7) | 2 |
| Brief spike | 55% | 2 | scale_up 4 (0.65) | ❌ (conf < 0.7) | 2 |
| Settling | 35% | 1 | maintain (0.80) | ❌ (action≠scale_up) | 2 |
| Low load | 15% | 1 | — | — | 1 |
| Moderate | 45% | 2 | scale_up 2 (0.85) | ❌ (predicted ≤ reactive) | 2 |

**Result**: reactive 80.0% = combined **80.0%** (override 0 times, no change)

---

## How to use

### Run tests

```bash
# Full accuracy backtest (responsive + predictive)
npx vitest run src/lib/__tests__/scaling-accuracy/ --reporter=verbose

# Run unit test + accuracy backtest together
npx vitest run src/lib/__tests__/scaling-decision.test.ts src/lib/__tests__/scaling-accuracy/

# Full scaling-related tests (including agent-loop, block-interval)
npx vitest run src/lib/__tests__/scaling-decision.test.ts \
  src/lib/__tests__/scaling-accuracy/ \
  src/lib/__tests__/block-interval.test.ts \
  src/lib/__tests__/agent-loop.test.ts
```

### Example output

**Responsive:**

```
  === OVERALL ACCURACY: 92.6% ===
  idle_to_spike: 75.0% (6/8) under=2 over=0
  gradual_rise: 100.0% (7/7) under=0 over=0
  oscillating: 100.0% (6/6) under=0 over=0
  sustained_critical: 100.0% (6/6) under=0 over=0

  Recommendations:
    - Under-scaled 2x in "idle_to_spike" — review idle/normal thresholds
```

**Predictive:**

```
  === PREDICTIVE OVERRIDE SUMMARY ===
  Total accuracy: 84.6%
  Total overrides: 1 (helpful=1, harmful=0)
  predictive_spike_rescue: reactive=75.0% → combined=87.5% (overrides=1)
  predictive_false_alarm: reactive=80.0% → combined=80.0% (overrides=0)
```

**Step-by-step details:**

```
    [OK]    Idle baseline: expected=1 got=1 (score=6.5)
    [UNDER] Spike begins: expected=4 got=2 (score=65)
    [OK]    Peak spike: expected=4 got=4 (score=75.6)
```

- `[OK]`: Algorithm judgment = operator expectation
- `[UNDER]`: algorithm determines lower vCPU than operator (under-scaling)
- `[OVER]`: algorithm determines higher vCPU than operator (over-scaling)

### Interpretation of results

| Accuracy | Meaning | action |
|--------|------|------|
| 90%+ | Excellent — Algorithm closely matches operator | Maintenance |
| 70~90% | Good — Deviation under certain scenarios | Fine-tune the threshold after analyzing under/over patterns |
| 50~70% | Poor — weights or thresholds need to be redesigned | Detailed analysis by scenario |
| <50% | Serious — structural problems with the formula itself | Weight ratio, metric composition revisited |

---

## Adjust weights and thresholds

### Change threshold with environmental variables

```bash
# Adjust threshold in .env.local
SCALING_IDLE_THRESHOLD=30 # Default: 30 (or less than 1 vCPU)
SCALING_NORMAL_THRESHOLD=70 # Default: 70 (2 vCPU below, 4 vCPU above)
SCALING_CRITICAL_THRESHOLD=77 # Default: 77 (or more than 8 vCPU)
```

### Change weights in code

Edit `DEFAULT_SCALING_CONFIG.weights` in `src/types/scaling.ts`:

```typescript
weights: {
cpu: 0.3, // CPU utilization weighting (currently 30%)
gas: 0.3, // Gas usage weight (currently 30%)
txPool: 0.2, // TxPool queue weight (currently 20%)
ai: 0.2, // AI severity weight (currently 20%)
},
```

> **Note**: The weight sum must be 1.0. After making changes, be sure to re-run the backtest to check for changes in accuracy.

### Coordination Workflow

```
1. Run backtest → Check current accuracy
2. [UNDER]/[OVER] pattern analysis
3. Modify thresholds or weights
4. Rerun backtest → Check accuracy improvement
5. Verify that there is no decrease in accuracy in other scenarios (prevention of regression)
```

Example: "In idle_to_spike, the Spike begins phase is under-scaling"

```
Problem: score=65 requires 4 vCPU → falls short of Normal threshold (70)
Resolution options:
A. Lower the Normal threshold to 65 → Check the impact of other scenarios
B. CPU weight increases from 0.3 to 0.35 → Increases sensitivity to high CPU situations
C. Complement with predictive override → Refer to PREDICTIVE_SPIKE_RESCUE scenario
D. Reassess scenario expectations → re-evaluate whether 2 vCPU is reasonable at score=65
```

---

## Add new scenario

### Responsive Scenario

#### Step 1: Define the scenario

Add a new scenario to `scenarios.ts`:

```typescript
export const MY_SCENARIO: ScalingScenario = {
  name: 'my_scenario',
  description: 'Description of the load pattern',
  steps: [
    {
      offsetSeconds: 0,
      metrics: makePoint(0, /* cpu */ 10, /* txPool */ 20, /* gasRatio */ 0.1),
      expectedVcpu: 1,
      label: 'Initial state',
    },
    {
      offsetSeconds: 60,
      metrics: makePoint(60, 80, 200, 0.8),
      expectedVcpu: 4,
      label: 'Load spike',
    },
// ... additional steps
  ],
};
```

Use the `makePoint(offsetSeconds, cpu, txPool, gasRatio)` helper. Set `expectedVcpu` manually at operator discretion — do not calculate it using a formula.

#### Step 2: Register with ALL_SCENARIOS

```typescript
export const ALL_SCENARIOS: ScalingScenario[] = [
  IDLE_TO_SPIKE,
  GRADUAL_RISE,
  OSCILLATING,
  SUSTAINED_CRITICAL,
MY_SCENARIO, // Add
];
```

#### Step 3: Add tests

Add a describe block to `scaling-accuracy.test.ts`:

```typescript
import { MY_SCENARIO } from './scenarios';

describe('Scenario: my_scenario', () => {
  const result = backtestScenario(MY_SCENARIO);

  it('should report accuracy against operator expectations', () => {
    console.log(`  my_scenario accuracy: ${result.accuracy.toFixed(1)}%`);
    for (const s of result.stepDecisions) {
      const mark = s.correct ? 'OK' : s.vcpuDelta > 0 ? 'OVER' : 'UNDER';
      console.log(`    [${mark}] ${s.step.label}: expected=${s.step.expectedVcpu} got=${s.decision.targetVcpu} (score=${s.decision.score})`);
    }
    expect(result.accuracy).toBeGreaterThanOrEqual(50);
  });
});
```

### Predictive Scenario

#### Step 1: Define scenario with mockPrediction

Create a mock prediction using the `makePrediction()` helper in `scenarios.ts`:

```typescript
import { makePrediction, makePoint } from './scenarios';

export const MY_PREDICTIVE_SCENARIO: ScalingScenario = {
  name: 'my_predictive_scenario',
  description: 'Prediction-enhanced scenario',
  steps: [
    {
      offsetSeconds: 0,
      metrics: makePoint(0, 50, 100, 0.5),
      expectedVcpu: 2,
      label: 'Normal load',
    },
    {
      offsetSeconds: 60,
      metrics: makePoint(60, 60, 120, 0.6),
      expectedVcpu: 4,
      label: 'Rising load',
      mockPrediction: makePrediction(
        4,            // predictedVcpu (1 | 2 | 4)
0.85, // confidence (can be overridden if >= 0.7)
'scale_up', // action (only 'scale_up' can be overridden)
        'rising',     // trend
      ),
    },
  ],
};
```

#### Step 2: Register with ALL_PREDICTIVE_SCENARIOS

```typescript
export const ALL_PREDICTIVE_SCENARIOS: ScalingScenario[] = [
  PREDICTIVE_SPIKE_RESCUE,
  PREDICTIVE_FALSE_ALARM,
MY_PREDICTIVE_SCENARIO, // Add
];
```

#### Step 3: Add tests

```typescript
describe('Predictive: my_scenario', () => {
  const result = backtestPredictiveScenario(MY_PREDICTIVE_SCENARIO);

  it('should report reactive vs combined accuracy', () => {
    console.log(`  Reactive: ${result.reactiveAccuracy.toFixed(1)}%`);
    console.log(`  Combined: ${result.combinedAccuracy.toFixed(1)}%`);
    console.log(`  Overrides: ${result.overrideCount} (helpful=${result.helpfulOverrides})`);
    expect(result.combinedAccuracy).toBeGreaterThanOrEqual(50);
  });
});
```

> Using `backtestScenario()` will cause the `mockPrediction` field to be ignored and only the responsive will be tested.
> You must use `backtestPredictiveScenario()` for the prediction override to take effect.

#### Step 4: Run and Verify

```bash
npx vitest run src/lib/__tests__/scaling-accuracy/ --reporter=verbose
```

---

## Current results (2026-02-18)

### Responsive

| Scenario | Accuracy | Match/All | Under | Over | Remarks |
|----------|--------|----------|-------|------|------|
| idle_to_spike | 75.0% | 6/8 | 2 | 0 | At Spike begins, score=65 (below Normal threshold of 70) |
| gradual_rise | 100.0% | 7/7 | 0 | 0 | Perfect match |
| oscillating | 100.0% | 6/6 | 0 | 0 | Perfect match |
| sustained_critical | 100.0% | 6/6 | 0 | 0 | Perfect match |
| **Comprehensive** | **92.6%** | **25/27** | **2** | **0** | |

### 예측형 (Reactive + Predictive)

| Scenario | Responsive | combine | improvement | Override | Helpful | Harmful |
|----------|--------|------|------|-----------|---------|---------|
| predictive_spike_rescue | 75.0% | 87.5% | +12.5%p | 1 | 1 | 0 |
| predictive_false_alarm | 80.0% | 80.0% | ±0 | 0 | 0 | 0 |
| **Comprehensive** | — | **84.6%** | — | **1** | **1** | **0** |

### Known limitations

- **Sudden spike detection delay**: The combination of CPU 80% + Gas 85% + TxPool 180 is below the Normal threshold (70) with score=65, so it is determined as 2 vCPU. Predictive overrides can compensate for this (see `PREDICTIVE_SPIKE_RESCUE`).
- **AI severity not reflected**: AI severity is not included in the current scenario. Accuracy may vary when AI analytics is enabled.
- **Cooldown misimulation**: Backtest evaluates each step independently, and in actual operation, there is a 5-minute cooldown, which may limit continuous scale-up.
- **Prediction vCPU upper limit**: `PredictionResult.predictedVcpu` has type `1 | 2 | Since it is 4`, predictive type can only override up to 4 vCPU. 8 vCPU achieved with responsive only.

---

## Related files

| file | Role |
|------|------|
| `src/lib/scaling-decision.ts` | Scaling decision engine (formula, tier determination, reason generation) |
| `src/lib/predictive-scaler.ts` | Predictive scaling engine (AI time series analysis) |
| `src/lib/agent-loop.ts` | Autonomous agent loop (applies reactive + predictive overrides) |
| `src/types/scaling.ts` | Type + Preferences (Weights, Thresholds, AI Severity Score) |
| `src/types/prediction.ts` | 예측 타입 (PredictionResult, PredictionConfig) |
| `src/lib/__tests__/scaling-decision.test.ts` | Unit tests (39) |
| `src/lib/__tests__/scaling-accuracy/types.ts` | Backtest type definition (reactive + predictive) |
| `src/lib/__tests__/scaling-accuracy/scenarios.ts` | 6 scenarios (4 reactive + 2 predictive) |
| `src/lib/__tests__/scaling-accuracy/evaluator.ts` | (backtestScenario + backtestPredictiveScenario) |
| `src/lib/__tests__/scaling-accuracy/scaling-accuracy.test.ts` | Accuracy Test Suite (29) |
