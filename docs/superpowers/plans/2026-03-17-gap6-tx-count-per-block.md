# GAP-6: txCountPerBlock 메트릭 수집 및 이상 감지 구현

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `block.transactions.length`를 `txCountPerBlock` 메트릭으로 링버퍼에 저장하고 Z-Score 이상 감지를 추가하여 트래픽 급증 감지 정확도를 높인다.

**Architecture:** GAP-1(memoryPercent)과 동일한 패턴. `block` 객체는 이미 /api/metrics/route.ts에서 fetch되어 `txPoolPending` fallback용으로 `.transactions.length`를 사용 중이므로 추가 RPC 비용 없음. 신규 필드를 `MetricDataPoint`에 optional로 추가 → `CORE_ANOMALY_METRICS` 등록 → dataPoint에 포함 → anomaly-detector Z-Score 감지.

**Tech Stack:** TypeScript, Vitest, viem (block data already fetched)

---

## 파일 구조 (수정 대상)

| 파일 | 변경 |
|------|------|
| `src/types/prediction.ts` | `txCountPerBlock?: number` 필드 추가 |
| `src/types/anomaly.ts` | `CORE_ANOMALY_METRICS`에 `'txCountPerBlock'` 추가 |
| `src/lib/anomaly-detector.ts` | SUSTAINED_COUNT, MIN_STD_DEV 항목 추가 + Z-Score 감지 블록 추가 |
| `src/app/api/metrics/route.ts` | dataPoint에 `txCountPerBlock` 포함 |
| `src/lib/__tests__/anomaly-detector.test.ts` | `txCountPerBlock` 감지 테스트 추가 |
| `src/lib/__tests__/playbook-matcher-coverage.test.ts` | (플레이북 없음 — 생략) |

> 플레이북 수정 없음: GAP-6은 트래픽 급증 조기 탐지용 지표 보강이므로 기존 `txPoolPending` 플레이북이 correlation 역할을 한다. `txCountPerBlock` 전용 플레이북은 이 PR 범위 밖.

---

### Task 1: MetricDataPoint에 txCountPerBlock 필드 추가

**Files:**
- Modify: `src/types/prediction.ts:47` (customMetrics 필드 직전)
- Test: `src/lib/__tests__/anomaly-detector.test.ts` (기존 파일에 추가)

- [ ] **Step 1: `src/types/prediction.ts`에 필드 추가**

`customMetrics?: Record<string, number>;` 바로 위에 아래 내용을 삽입:

```typescript
/** Number of transactions in the latest L2 block (leading indicator for traffic surge) */
txCountPerBlock?: number;
```

- [ ] **Step 2: `CORE_ANOMALY_METRICS`에 항목 추가**

`src/types/anomaly.ts` line 27의 배열에 `'txCountPerBlock'` 추가:

```typescript
export const CORE_ANOMALY_METRICS = [
  'cpuUsage',
  'memoryPercent',
  'txCountPerBlock',   // ← 추가
  'txPoolPending',
  'gasUsedRatio',
  'l2BlockHeight',
  'l2BlockInterval',
] as const;
```

- [ ] **Step 3: 타입 체크 확인**

```bash
npx tsc --noEmit
```

Expected: 0 errors (optional 필드이므로 기존 `makeMetric()` 호출 변경 불필요)

- [ ] **Step 4: 커밋**

```bash
git add src/types/prediction.ts src/types/anomaly.ts
git commit -m "feat(types): add txCountPerBlock to MetricDataPoint and CORE_ANOMALY_METRICS"
```

---

### Task 2: anomaly-detector에 txCountPerBlock Z-Score 감지 추가

**Files:**
- Modify: `src/lib/anomaly-detector.ts:41-60` (SUSTAINED_COUNT, MIN_STD_DEV)
- Modify: `src/lib/anomaly-detector.ts:404-417` (memoryPercent 블록 바로 뒤에 추가)
- Test: `src/lib/__tests__/anomaly-detector.test.ts`

- [ ] **Step 1: 실패 테스트 먼저 작성**

`src/lib/__tests__/anomaly-detector.test.ts`에서 `describe('memoryPercent Z-Score detection')` 블록 뒤에 추가:

```typescript
describe('txCountPerBlock Z-Score detection', () => {
  function makeMetricWithTx(txCount: number): MetricDataPoint {
    return {
      timestamp: new Date().toISOString(),
      cpuUsage: 50,
      txPoolPending: 100,
      gasUsedRatio: 0.5,
      blockHeight: 1000,
      blockInterval: 2.0,
      currentVcpu: 2,
      txCountPerBlock: txCount,
    };
  }

  it('should not detect anomaly for stable tx count', () => {
    const history = Array.from({ length: 15 }, (_, i) =>
      makeMetricWithTx(20 + (i % 3))  // 20-22 range, low variance
    );
    const current = makeMetricWithTx(22);
    const anomalies = detectAnomalies(current, history);
    const txAnomaly = anomalies.find(a => a.metric === 'txCountPerBlock');
    expect(txAnomaly).toBeUndefined();
  });

  it('should detect spike when tx count surges above historical mean', () => {
    const history = Array.from({ length: 15 }, () => makeMetricWithTx(20));
    const current = makeMetricWithTx(200);  // 10x surge
    const anomalies = detectAnomalies(current, history);
    const txAnomaly = anomalies.find(a => a.metric === 'txCountPerBlock');
    expect(txAnomaly).toBeDefined();
    expect(txAnomaly?.direction).toBe('spike');
  });

  it('should skip detection when txCountPerBlock is undefined', () => {
    const history = Array.from({ length: 15 }, (_, i) => makeMetricWithTx(20 + i));
    const current: MetricDataPoint = {
      timestamp: new Date().toISOString(),
      cpuUsage: 50,
      txPoolPending: 100,
      gasUsedRatio: 0.5,
      blockHeight: 1000,
      blockInterval: 2.0,
      currentVcpu: 2,
      // txCountPerBlock: undefined (omitted)
    };
    const anomalies = detectAnomalies(current, history);
    const txAnomaly = anomalies.find(a => a.metric === 'txCountPerBlock');
    expect(txAnomaly).toBeUndefined();
  });

  it('should skip detection when history has insufficient txCountPerBlock data', () => {
    // Only 2 history points with txCountPerBlock data (< MIN_HISTORY_POINTS)
    const history = [
      makeMetricWithTx(20),
      makeMetricWithTx(20),
    ];
    const current = makeMetricWithTx(200);
    const anomalies = detectAnomalies(current, history);
    const txAnomaly = anomalies.find(a => a.metric === 'txCountPerBlock');
    expect(txAnomaly).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/__tests__/anomaly-detector.test.ts --reporter=verbose 2>&1 | grep -A3 "txCountPerBlock"
```

Expected: spike test fails with "undefined" (구현 없으므로)

- [ ] **Step 3: SUSTAINED_COUNT와 MIN_STD_DEV에 txCountPerBlock 추가**

`src/lib/anomaly-detector.ts`:

```typescript
// SUSTAINED_COUNT (line ~46 다음):
txCountPerBlock: parseInt(process.env.ANOMALY_SUSTAINED_COUNT_TX_COUNT || String(DEFAULT_SUSTAINED_COUNT), 10),

// MIN_STD_DEV (line ~60 다음):
txCountPerBlock: parseFloat(process.env.ANOMALY_MIN_STD_DEV_TX_COUNT || '5'),
```

> `MIN_STD_DEV = 5`: 블록당 tx 수는 0~수백 범위이므로 stdDev가 5 미만이면 안정적 상태로 판단. memoryPercent(0.5)보다 훨씬 높은 값 사용.

- [ ] **Step 4: memoryPercent 블록 뒤에 Z-Score 감지 추가**

`src/lib/anomaly-detector.ts` line 417 (memoryPercent 블록 닫는 `}` 뒤):

```typescript
// Tx Count Per Block Z-Score (only if txCountPerBlock data is available)
if (current.txCountPerBlock !== undefined && current.txCountPerBlock >= 0) {
  const txCountHistory = history
    .map(p => p.txCountPerBlock)
    .filter((v): v is number => v !== undefined && v >= 0);
  if (txCountHistory.length >= MIN_HISTORY_POINTS) {
    const txCountAnomaly = detectZScoreAnomaly(
      'txCountPerBlock',
      current.txCountPerBlock,
      txCountHistory
    );
    if (txCountAnomaly) anomalies.push(txCountAnomaly);
  }
}
```

> `>= 0` 사용: 빈 블록(0 tx)도 유효한 값이므로 `> 0` 대신 `>= 0` 사용.

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/lib/__tests__/anomaly-detector.test.ts
```

Expected: all tests pass including new txCountPerBlock tests

- [ ] **Step 6: 커밋**

```bash
git add src/lib/anomaly-detector.ts src/lib/__tests__/anomaly-detector.test.ts
git commit -m "feat(anomaly-detector): add txCountPerBlock Z-Score detection"
```

---

### Task 3: /api/metrics dataPoint에 txCountPerBlock 포함

**Files:**
- Modify: `src/app/api/metrics/route.ts:867-884` (dataPoint 생성 블록)

- [ ] **Step 1: 실패 테스트 작성 (isolation test 파일 확인)**

`src/app/api/metrics/route.isolation.test.ts` 파일을 읽어 테스트 패턴 확인 후,
`txCountPerBlock`이 dataPoint에 포함되는지 검증하는 테스트 추가:

```typescript
it('should include txCountPerBlock in dataPoint when block is available', async () => {
  // block.transactions.length가 dataPoint에 포함되는지 확인
  // (기존 테스트 패턴에 맞춰 작성)
  const response = await GET(mockRequest);
  const data = await response.json();
  // txCountPerBlock이 metrics 응답에 포함되어야 함 (optional field이므로 0 이상)
  expect(data.metrics.txCountPerBlock).toBeGreaterThanOrEqual(0);
});
```

> Note: isolation test 파일이 복잡하면 이 단계는 생략하고 단위 테스트만 검증.

- [ ] **Step 2: dataPoint 생성 블록에 txCountPerBlock 추가**

`src/app/api/metrics/route.ts`의 dataPoint 생성 부분 (현재 line ~867):

현재 코드에서 `...(containerUsage ? {...} : {})` 블록 뒤에 추가:

```typescript
// txCountPerBlock: leading indicator for traffic surge detection
// block.transactions is already fetched — zero additional RPC cost
...(block ? {
  txCountPerBlock: block.transactions.length,
} : {}),
```

> `block`이 존재하는 경우에만 포함 (시뮬레이션/seed 모드에서는 block이 없을 수 있음).
> 단, 코드를 읽어 `block`이 이 시점에서 항상 존재하는지 확인 후 조건부 사용 여부 결정.

- [ ] **Step 3: 타입 체크 및 테스트 통과 확인**

```bash
npx tsc --noEmit
npx vitest run src/lib/__tests__/anomaly-detector.test.ts
npx vitest run src/lib/__tests__/
```

Expected: 0 type errors, all tests pass

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/metrics/route.ts
git commit -m "feat(metrics): include txCountPerBlock in dataPoint from block.transactions.length"
```

---

### Task 4: 전체 회귀 테스트 및 완료

- [ ] **Step 1: 전체 테스트 실행**

```bash
npx vitest run src/lib/__tests__/
```

Expected: 기존 테스트 모두 통과 (txCountPerBlock이 optional이므로 기존 `makeMetric()` 변경 불필요)

- [ ] **Step 2: 시나리오 테스트 확인**

```bash
npx vitest run src/lib/__tests__/scenarios/
```

- [ ] **Step 3: 타입 체크 최종 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 최종 커밋 (필요 시)**

변경된 파일이 있으면 커밋.

---

## 검증 체크리스트

```
✓ MetricDataPoint.txCountPerBlock optional 필드 추가
✓ CORE_ANOMALY_METRICS에 'txCountPerBlock' 포함
✓ anomaly-detector: SUSTAINED_COUNT + MIN_STD_DEV 항목 추가
✓ anomaly-detector: Z-Score 감지 블록 (>= 0 조건)
✓ /api/metrics: block.transactions.length → dataPoint.txCountPerBlock
✓ 테스트: stable → no anomaly, 10x surge → spike detected
✓ 테스트: undefined 스킵, 데이터 부족 스킵
✓ 기존 테스트 회귀 없음
✓ TypeScript: 0 errors
```
