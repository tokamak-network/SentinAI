# 스케일링 정확도 테스팅 프레임워크 가이드

SentinAI의 스케일링 알고리즘(반응형 + 예측형)이 실제 운영자 기대와 얼마나 일치하는지 측정하는 백테스팅 프레임워크.

---

## 원리

### 무엇을 측정하는가?

이 프레임워크는 세 가지 질문에 답합니다:

1. **코드 정확성**: 스케일링 공식이 설계대로 계산되는가? (`scaling-decision.test.ts`)
2. **반응형 판단 정확도**: 공식의 가중치/임계값이 시니어 SRE의 판단과 일치하는가?
3. **예측형 개선 효과**: 예측 오버라이드가 반응형의 약점을 보완하는가?

### 테스트 구분

| | 단위 테스트 | 반응형 백테스트 | 예측형 백테스트 |
|---|---|---|---|
| **파일** | `scaling-decision.test.ts` | `scaling-accuracy/` | `scaling-accuracy/` |
| **기준** | 코드 설계 명세 | 운영자 판단 | 운영자 판단 |
| **함수** | 개별 함수 검증 | `backtestScenario()` | `backtestPredictiveScenario()` |
| **실패 의미** | 버그 | 가중치/임계값 조정 필요 | 오버라이드 조건 조정 필요 |
| **AI 필요** | 불필요 | 불필요 | 불필요 (mock prediction) |

### 스케일링 공식 (참고)

```
score = cpu * 0.3 + gas * 100 * 0.3 + min(txPool/200, 1) * 100 * 0.2 + aiScore * 0.2
```

| 점수 범위 | 티어 | vCPU | 메모리 |
|-----------|------|------|--------|
| < 30 | Idle | 1 | 2 GiB |
| 30 ~ 70 | Normal | 2 | 4 GiB |
| 70 ~ 77 | High | 4 | 8 GiB |
| >= 77 | Critical | 8 | 16 GiB |

> **참고**: AI severity 없이 최대 점수는 80 (CPU 30 + Gas 30 + TxPool 20). Critical 임계값이 77이므로 AI 없이도 8 vCPU 도달 가능.

### 예측형 오버라이드 조건

```
오버라이드 발동 조건 (모두 만족해야 함):
1. prediction.confidence >= 0.7 (70%)
2. prediction.recommendedAction === 'scale_up' (스케일업만)
3. prediction.predictedVcpu > reactiveVcpu (더 높은 vCPU)
```

즉, 예측형은 **선제적 스케일업만** 가능합니다. 스케일다운이나 유지 추천은 무시됩니다.

---

## 아키텍처

```
scaling-accuracy/
├── types.ts                    # 타입 (ScenarioStep, BacktestResult, PredictiveBacktestResult)
├── scenarios.ts                # 6가지 메트릭 시퀀스 (반응형 4 + 예측형 2)
├── evaluator.ts                # 백테스트 엔진 (backtestScenario, backtestPredictiveScenario)
└── scaling-accuracy.test.ts    # Vitest 테스트 스위트 (29개)
```

### 반응형 동작 방식

```
scenarios.ts          evaluator.ts              scaling-decision.ts
┌─────────────┐      ┌──────────────────┐      ┌─────────────────┐
│ 시나리오     │      │ backtestScenario │      │ makeScaling     │
│ [step1]     │─────▶│   for each step: │─────▶│   Decision()    │
│ [step2]     │      │     metrics →    │      │   score 계산    │
│ [step3]     │      │     decision =   │◀─────│   vCPU 결정     │
│ ...         │      │     compare with │      └─────────────────┘
│ expectedVcpu│      │     expectedVcpu │
└─────────────┘      │                  │
                     │   결과:          │
                     │   accuracy %     │
                     │   under/over cnt │
                     └──────────────────┘
```

### 예측형 동작 방식

```
scenarios.ts          evaluator.ts                           scaling-decision.ts
┌──────────────┐     ┌──────────────────────────┐           ┌─────────────────┐
│ 시나리오      │     │ backtestPredictiveScenario│           │ makeScaling     │
│ [step]       │────▶│   1. reactive decision ───│──────────▶│   Decision()    │
│  metrics     │     │   2. override check:      │◀──────────│   score → vCPU  │
│  mockPredict │     │      conf >= 0.7?         │           └─────────────────┘
│  expectedVcpu│     │      action == scale_up?  │
└──────────────┘     │      predicted > reactive?│
                     │   3. final = override or  │
                     │      reactive             │
                     │   4. compare expectedVcpu │
                     │                           │
                     │   결과:                   │
                     │   reactiveAccuracy        │
                     │   combinedAccuracy        │
                     │   overrideCount           │
                     │   helpful / harmful       │
                     └──────────────────────────┘
```

1. 시나리오의 각 단계(step)에서 메트릭을 추출
2. `makeScalingDecision()`에 전달하여 반응형 결과 수집
3. `mockPrediction`이 있으면 오버라이드 조건 확인 → 조건 충족 시 예측 vCPU 사용
4. 최종 `targetVcpu`와 운영자 기대 `expectedVcpu`를 비교
5. 반응형 정확도 / 결합 정확도 / 오버라이드 통계 동시 산출

---

## 반응형 시나리오 (4개)

### 1. `idle_to_spike` — 유휴 → 급격한 스파이크 → 회복

저부하 상태에서 갑자기 CPU 95%, TxPool 400까지 치솟은 후 다시 안정화되는 패턴.

| 단계 | CPU | Gas | TxPool | 운영자 기대 | 검증 대상 |
|------|-----|-----|--------|------------|-----------|
| Idle baseline | 10% | 5% | 20 | 1 vCPU | 안정 시 과잉 프로비저닝 방지 |
| Spike begins | 80% | 85% | 180 | 4 vCPU | 스파이크 감지 속도 |
| Peak spike | 92% | 95% | 300 | 4 vCPU | 점진적 스케일업 |
| Sustained peak | 95% | 98% | 350 | 8 vCPU | 지속 고부하 → 긴급 모드 |
| Critical | 98% | 99% | 400 | 8 vCPU | 최대 티어 유지 |
| Recovery | 40% | 30% | 50 | 2 vCPU | 스케일다운 |
| Post-spike idle | 8% | 5% | 10 | 1 vCPU | 완전 복귀 |

### 2. `gradual_rise` — 점진적 부하 증가

부하가 천천히 올라가며 각 임계값 경계를 하나씩 넘는 패턴.

| 단계 | CPU | Gas | TxPool | 운영자 기대 | 검증 대상 |
|------|-----|-----|--------|------------|-----------|
| Low load | 10% | 10% | 20 | 1 vCPU | 저부하 유지 |
| Normal load begins | 40% | 40% | 80 | 2 vCPU | Normal 임계값 감지 |
| Approaching high | 70% | 70% | 150 | 2 vCPU | 불필요한 조기 스케일업 방지 |
| High load | 85% | 85% | 200 | 4 vCPU | High 티어 진입 |
| Peak high | 95% | 95% | 250 | 8 vCPU | Critical 티어 진입 |

### 3. `oscillating` — 진동 패턴 (저 ↔ 중)

저부하와 중부하를 반복하며 안정적으로 1~2 vCPU만 사용해야 하는 패턴.

| 단계 | CPU | Gas | TxPool | 운영자 기대 | 검증 대상 |
|------|-----|-----|--------|------------|-----------|
| Low | 15% | 15% | 30 | 1 vCPU | 안정 유지 |
| Medium | 50% | 55% | 100 | 2 vCPU | 적절한 스케일업 |
| Low | 12% | 12% | 20 | 1 vCPU | 스케일다운 |
| Medium | 52% | 58% | 105 | 2 vCPU | 안정 반복 |

> 핵심: 4 vCPU 이상으로 올라가면 **실패** — 과잉 프로비저닝.

### 4. `sustained_critical` — 지속적 고부하 → 회복

극심한 부하가 지속된 후 깨끗하게 스케일다운되는 패턴.

| 단계 | CPU | Gas | TxPool | 운영자 기대 | 검증 대상 |
|------|-----|-----|--------|------------|-----------|
| Critical | 95% | 95% | 280 | 8 vCPU | 즉시 최대 티어 |
| Max load | 100% | 100% | 400 | 8 vCPU | 유지 |
| Cooling down | 60% | 60% | 150 | 2 vCPU | 적절한 스케일다운 |
| Normal | 8% | 5% | 10 | 1 vCPU | 최저 복귀 |

---

## 예측형 시나리오 (2개)

### 5. `predictive_spike_rescue` — 예측이 under-scaling 보완

반응형이 score=65로 2 vCPU를 결정하는 스파이크 시작 단계에서, AI 예측(confidence=0.88, scale_up)이 4 vCPU로 오버라이드합니다.

| 단계 | CPU | 반응형 | 예측 (mock) | 오버라이드 | 운영자 기대 |
|------|-----|--------|------------|-----------|------------|
| Idle baseline | 10% | 1 | — | — | 1 |
| Idle | 12% | 1 | maintain (0.80) | ❌ | 1 |
| Spike begins | 80% | 2 | **scale_up 4 (0.88)** | **✅** | **4** |
| Peak spike | 92% | 4 | maintain (0.82) | ❌ | 4 |
| Sustained peak | 95% | 8 | maintain (0.75) | ❌ | 8 |
| Critical | 98% | 8 | — | — | 8 |
| Recovery | 40% | 1 | scale_down (0.90) | ❌ (action≠scale_up) | 1 |
| Post-spike idle | 8% | 1 | — | — | 1 |

**결과**: reactive 75.0% → combined **87.5%** (+12.5%p, helpful override 1회)

### 6. `predictive_false_alarm` — 낮은 신뢰도 예측 무시

AI가 scale_up을 추천하지만 confidence < 0.7이므로 오버라이드 발동 안 됨. 반응형 결과 유지.

| 단계 | CPU | 반응형 | 예측 (mock) | 오버라이드 | 운영자 기대 |
|------|-----|--------|------------|-----------|------------|
| Normal load | 40% | 2 | scale_up 4 (0.55) | ❌ (conf < 0.7) | 2 |
| Brief spike | 55% | 2 | scale_up 4 (0.65) | ❌ (conf < 0.7) | 2 |
| Settling | 35% | 1 | maintain (0.80) | ❌ (action≠scale_up) | 2 |
| Low load | 15% | 1 | — | — | 1 |
| Moderate | 45% | 2 | scale_up 2 (0.85) | ❌ (predicted ≤ reactive) | 2 |

**결과**: reactive 80.0% = combined **80.0%** (override 0회, 변화 없음)

---

## 사용법

### 테스트 실행

```bash
# 전체 정확도 백테스트 (반응형 + 예측형)
npx vitest run src/lib/__tests__/scaling-accuracy/ --reporter=verbose

# 단위 테스트 + 정확도 백테스트 함께 실행
npx vitest run src/lib/__tests__/scaling-decision.test.ts src/lib/__tests__/scaling-accuracy/

# 전체 스케일링 관련 테스트 (agent-loop, block-interval 포함)
npx vitest run src/lib/__tests__/scaling-decision.test.ts \
  src/lib/__tests__/scaling-accuracy/ \
  src/lib/__tests__/block-interval.test.ts \
  src/lib/__tests__/agent-loop.test.ts
```

### 출력 예시

**반응형:**

```
  === OVERALL ACCURACY: 92.6% ===
  idle_to_spike: 75.0% (6/8) under=2 over=0
  gradual_rise: 100.0% (7/7) under=0 over=0
  oscillating: 100.0% (6/6) under=0 over=0
  sustained_critical: 100.0% (6/6) under=0 over=0

  Recommendations:
    - Under-scaled 2x in "idle_to_spike" — review idle/normal thresholds
```

**예측형:**

```
  === PREDICTIVE OVERRIDE SUMMARY ===
  Total accuracy: 84.6%
  Total overrides: 1 (helpful=1, harmful=0)
  predictive_spike_rescue: reactive=75.0% → combined=87.5% (overrides=1)
  predictive_false_alarm: reactive=80.0% → combined=80.0% (overrides=0)
```

**단계별 상세:**

```
    [OK]    Idle baseline: expected=1 got=1 (score=6.5)
    [UNDER] Spike begins: expected=4 got=2 (score=65)
    [OK]    Peak spike: expected=4 got=4 (score=75.6)
```

- `[OK]`: 알고리즘 판단 = 운영자 기대
- `[UNDER]`: 알고리즘이 운영자보다 낮은 vCPU 결정 (under-scaling)
- `[OVER]`: 알고리즘이 운영자보다 높은 vCPU 결정 (over-scaling)

### 결과 해석

| 정확도 | 의미 | 조치 |
|--------|------|------|
| 90%+ | 우수 — 알고리즘이 운영자와 거의 일치 | 유지 |
| 70~90% | 양호 — 특정 시나리오에서 편차 | under/over 패턴 분석 후 임계값 미세조정 |
| 50~70% | 미흡 — 가중치 또는 임계값 재설계 필요 | 시나리오별 상세 분석 |
| <50% | 심각 — 공식 자체에 구조적 문제 | 가중치 비율, 메트릭 구성 재검토 |

---

## 가중치 및 임계값 조정

### 환경변수로 임계값 변경

```bash
# .env.local에서 임계값 조정
SCALING_IDLE_THRESHOLD=30       # 기본값: 30 (이하면 1 vCPU)
SCALING_NORMAL_THRESHOLD=70     # 기본값: 70 (이하면 2 vCPU, 이상이면 4 vCPU)
SCALING_CRITICAL_THRESHOLD=77   # 기본값: 77 (이상이면 8 vCPU)
```

### 코드에서 가중치 변경

`src/types/scaling.ts`에서 `DEFAULT_SCALING_CONFIG.weights`를 수정합니다:

```typescript
weights: {
  cpu: 0.3,     // CPU 사용률 가중치 (현재 30%)
  gas: 0.3,     // Gas 사용률 가중치 (현재 30%)
  txPool: 0.2,  // TxPool 대기열 가중치 (현재 20%)
  ai: 0.2,      // AI 심각도 가중치 (현재 20%)
},
```

> **주의**: 가중치 합계는 반드시 1.0이어야 합니다. 변경 후 반드시 백테스트를 재실행하여 정확도 변화를 확인하세요.

### 조정 워크플로우

```
1. 백테스트 실행 → 현재 정확도 확인
2. [UNDER]/[OVER] 패턴 분석
3. 임계값 또는 가중치 수정
4. 백테스트 재실행 → 정확도 개선 확인
5. 다른 시나리오 정확도 저하 없는지 확인 (회귀 방지)
```

예시: "idle_to_spike에서 Spike begins 단계가 under-scaling"

```
문제: score=65인데 4 vCPU 필요 → Normal 임계값(70)에 미달
해결 옵션:
  A. Normal 임계값 65로 낮춤 → 다른 시나리오 영향 확인
  B. CPU 가중치 0.3→0.35 증가 → 고CPU 상황 민감도 상승
  C. 예측형 오버라이드로 보완 → PREDICTIVE_SPIKE_RESCUE 시나리오 참고
  D. 시나리오 기대값 재검토 → score=65에서 2 vCPU가 합리적인지 재평가
```

---

## 새 시나리오 추가

### 반응형 시나리오

#### 1단계: 시나리오 정의

`scenarios.ts`에 새 시나리오를 추가합니다:

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
    // ... 추가 단계
  ],
};
```

`makePoint(offsetSeconds, cpu, txPool, gasRatio)` 헬퍼를 사용합니다. `expectedVcpu`는 운영자 판단으로 수동 설정하세요 — 공식으로 계산하지 마세요.

#### 2단계: ALL_SCENARIOS에 등록

```typescript
export const ALL_SCENARIOS: ScalingScenario[] = [
  IDLE_TO_SPIKE,
  GRADUAL_RISE,
  OSCILLATING,
  SUSTAINED_CRITICAL,
  MY_SCENARIO,  // 추가
];
```

#### 3단계: 테스트 추가

`scaling-accuracy.test.ts`에 describe 블록을 추가합니다:

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

### 예측형 시나리오

#### 1단계: mockPrediction 포함 시나리오 정의

`scenarios.ts`에서 `makePrediction()` 헬퍼를 사용하여 mock prediction을 생성합니다:

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
        0.85,         // confidence (>= 0.7이면 오버라이드 가능)
        'scale_up',   // action ('scale_up'만 오버라이드 가능)
        'rising',     // trend
      ),
    },
  ],
};
```

#### 2단계: ALL_PREDICTIVE_SCENARIOS에 등록

```typescript
export const ALL_PREDICTIVE_SCENARIOS: ScalingScenario[] = [
  PREDICTIVE_SPIKE_RESCUE,
  PREDICTIVE_FALSE_ALARM,
  MY_PREDICTIVE_SCENARIO,  // 추가
];
```

#### 3단계: 테스트 추가

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

> `backtestScenario()`를 사용하면 `mockPrediction` 필드가 무시되어 반응형만 테스트됩니다.
> `backtestPredictiveScenario()`를 사용해야 예측 오버라이드가 적용됩니다.

#### 4단계: 실행 및 검증

```bash
npx vitest run src/lib/__tests__/scaling-accuracy/ --reporter=verbose
```

---

## 현재 결과 (2026-02-18)

### 반응형 (Reactive)

| 시나리오 | 정확도 | 일치/전체 | Under | Over | 비고 |
|----------|--------|----------|-------|------|------|
| idle_to_spike | 75.0% | 6/8 | 2 | 0 | Spike begins에서 score=65 (Normal 임계값 70 미달) |
| gradual_rise | 100.0% | 7/7 | 0 | 0 | 완벽 일치 |
| oscillating | 100.0% | 6/6 | 0 | 0 | 완벽 일치 |
| sustained_critical | 100.0% | 6/6 | 0 | 0 | 완벽 일치 |
| **종합** | **92.6%** | **25/27** | **2** | **0** | |

### 예측형 (Reactive + Predictive)

| 시나리오 | 반응형 | 결합 | 개선 | 오버라이드 | Helpful | Harmful |
|----------|--------|------|------|-----------|---------|---------|
| predictive_spike_rescue | 75.0% | 87.5% | +12.5%p | 1 | 1 | 0 |
| predictive_false_alarm | 80.0% | 80.0% | ±0 | 0 | 0 | 0 |
| **종합** | — | **84.6%** | — | **1** | **1** | **0** |

### 알려진 한계

- **급격한 스파이크 감지 지연**: CPU 80% + Gas 85% + TxPool 180의 조합이 score=65로 Normal 임계값(70)에 미달하여 2 vCPU로 결정됨. 예측형 오버라이드가 이를 보완 가능 (`PREDICTIVE_SPIKE_RESCUE` 참고).
- **AI severity 미반영**: 현재 시나리오에는 AI severity가 포함되지 않음. AI 분석이 활성화되면 정확도가 달라질 수 있음.
- **쿨다운 미시뮬레이션**: 백테스트는 각 단계를 독립적으로 평가하며, 실제 운영 시 5분 쿨다운이 있어 연속 스케일업이 제한될 수 있음.
- **예측 vCPU 상한**: `PredictionResult.predictedVcpu`의 타입이 `1 | 2 | 4`이므로 예측형으로는 최대 4 vCPU까지만 오버라이드 가능. 8 vCPU는 반응형만으로 달성.

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/lib/scaling-decision.ts` | 스케일링 결정 엔진 (공식, 티어 결정, 사유 생성) |
| `src/lib/predictive-scaler.ts` | 예측형 스케일링 엔진 (AI 시계열 분석) |
| `src/lib/agent-loop.ts` | 자율 에이전트 루프 (반응형 + 예측형 오버라이드 적용) |
| `src/types/scaling.ts` | 타입 + 기본 설정 (가중치, 임계값, AI 심각도 점수) |
| `src/types/prediction.ts` | 예측 타입 (PredictionResult, PredictionConfig) |
| `src/lib/__tests__/scaling-decision.test.ts` | 단위 테스트 (39개) |
| `src/lib/__tests__/scaling-accuracy/types.ts` | 백테스트 타입 정의 (반응형 + 예측형) |
| `src/lib/__tests__/scaling-accuracy/scenarios.ts` | 6가지 시나리오 (반응형 4 + 예측형 2) |
| `src/lib/__tests__/scaling-accuracy/evaluator.ts` | 백테스트 엔진 (backtestScenario + backtestPredictiveScenario) |
| `src/lib/__tests__/scaling-accuracy/scaling-accuracy.test.ts` | 정확도 테스트 스위트 (29개) |
