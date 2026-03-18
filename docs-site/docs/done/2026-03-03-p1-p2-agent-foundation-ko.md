# P1-P2 감사 + Agent-for-Hire 기반 구현 계획

> **Claude에게:** 필수 서브스킬: `superpowers:executing-plans`를 사용하여 태스크를 순서대로 구현하십시오.

**목표:** 감사 P1-P2 엔진 개선 완료 및 Agent-for-Hire 기반 모듈 구축 (Experience Store, Pattern Extractor, Agent Resume, Outcome Tracker, Metrics History API).

**아키텍처:** P1 태스크는 엔진을 강화합니다 (더 빠른 무중단 스케일링, 병렬 NLOps, 영속적 RCA/예측 이력). P2는 관찰가능성을 추가합니다 (Trace ID). Agent-for-Hire 기반은 이를 바탕으로 운영 경험을 축적하고, 패턴을 추출하며, 에이전트 이력서를 생성하고, 결과를 추적합니다. 모든 신규 모듈은 기존 EventBus 및 IStateStore 패턴을 통해 통합됩니다.

**기술 스택:** TypeScript (strict), Vitest, Redis (IStateStore 경유), EventBus (agent-event-bus.ts), Pino logger

---

## Task 1: Zero-Downtime Phase 2 — 지수 백오프 폴링

**관련 파일:**
- 수정: `src/lib/zero-downtime-scaler.ts:270-316` (waitForReady 폴링 루프)
- 테스트: `src/lib/__tests__/zero-downtime-scaler.test.ts`

**배경:**
`waitForReady()`는 현재 고정 10초 폴링 간격을 사용합니다. 276-316번 줄의 루프는 `while (Date.now() - startTime < timeoutMs)`에서 일정한 `await _testHooks.sleep(intervalMs)`를 실행합니다. 지수 백오프 `[1s, 2s, 5s, 10s, 10s, ...]`를 적용하여 초기 체크는 빠르게 하되 kubectl 과부하를 방지합니다.

**Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/zero-downtime-scaler.test.ts`에 백오프 간격을 검증하는 새 테스트를 추가합니다:

```typescript
it('should use exponential backoff intervals for polling', async () => {
  const sleepCalls: number[] = [];
  const originalSleep = _testHooks.sleep;
  _testHooks.sleep = async (ms: number) => {
    sleepCalls.push(ms);
    // 실제로 대기하지 않음
  };

  // Mock: 처음 4번은 준비 안 됨, 5번째에 준비 완료
  let attempt = 0;
  mockRunK8sCommand.mockImplementation(async (cmd: string) => {
    if (cmd.includes('jsonpath') && cmd.includes('Ready')) {
      attempt++;
      return attempt >= 5 ? 'True' : 'False';
    }
    if (cmd.includes('jsonpath') && cmd.includes('podIP')) {
      return '10.0.0.1';
    }
    if (cmd.includes('exec') && cmd.includes('wget')) {
      return JSON.stringify({ result: '0x1' });
    }
    return '{}';
  });

  await waitForReady('test-pod', testConfig);

  // 백오프 패턴 검증: 1s, 2s, 5s, 10s
  expect(sleepCalls[0]).toBe(1000);
  expect(sleepCalls[1]).toBe(2000);
  expect(sleepCalls[2]).toBe(5000);
  expect(sleepCalls[3]).toBe(10000);

  _testHooks.sleep = originalSleep;
});
```

**Step 2: 테스트 실패 확인**

실행: `npx vitest run src/lib/__tests__/zero-downtime-scaler.test.ts -t "exponential backoff"`
예상: FAIL — 모든 sleep 호출이 10000ms

**Step 3: 지수 백오프 구현**

`src/lib/zero-downtime-scaler.ts`에서 고정 간격을 백오프 스케줄로 교체합니다. 270-276번 줄 부근:

```typescript
// Before (270-271번 줄):
const timeoutMs = parseInt(process.env.ZERO_DOWNTIME_READY_TIMEOUT_MS || '300000', 10);
const intervalMs = parseInt(process.env.ZERO_DOWNTIME_POLL_INTERVAL_MS || '10000', 10);

// After:
const timeoutMs = parseInt(process.env.ZERO_DOWNTIME_READY_TIMEOUT_MS || '300000', 10);
const BACKOFF_INTERVALS = [1000, 2000, 5000, 10000];
```

while 루프 본문(약 285번 줄)에서 고정 sleep을 교체합니다:

```typescript
// Before:
await _testHooks.sleep(intervalMs);

// After:
const backoffMs = BACKOFF_INTERVALS[Math.min(pollAttempt, BACKOFF_INTERVALS.length - 1)];
await _testHooks.sleep(backoffMs);
pollAttempt++;
```

while 루프 전에 `let pollAttempt = 0;`를 추가합니다.

**Step 4: 테스트 통과 확인**

실행: `npx vitest run src/lib/__tests__/zero-downtime-scaler.test.ts`
예상: ALL PASS

**Step 5: 커밋**

```bash
git add src/lib/zero-downtime-scaler.ts src/lib/__tests__/zero-downtime-scaler.test.ts
git commit -m "perf(zero-downtime): exponential backoff polling [1s,2s,5s,10s]"
```

---

## Task 2: Zero-Downtime Phase 2 — kubectl 호출 통합

**관련 파일:**
- 수정: `src/lib/zero-downtime-scaler.ts:278-303` (3개 kubectl 호출 → 1개 통합 + 병렬 RPC)
- 테스트: `src/lib/__tests__/zero-downtime-scaler.test.ts`

**배경:**
`waitForReady()`는 폴링마다 3개의 순차적 kubectl 호출을 실행합니다: (1) Ready 상태 조회, (2) podIP 조회, (3) RPC 체크를 위한 exec wget. (1)+(2)를 단일 jsonpath 호출로 통합하고 (3)은 파드 준비 후 병렬로 실행합니다.

**Step 1: 실패하는 테스트 작성**

```typescript
it('should use single kubectl call for ready+ip check', async () => {
  const kubectlCmds: string[] = [];
  mockRunK8sCommand.mockImplementation(async (cmd: string) => {
    kubectlCmds.push(cmd);
    if (cmd.includes('jsonpath') && cmd.includes('Ready')) {
      // 통합 응답: "True,10.0.0.1"
      return 'True,10.0.0.1';
    }
    if (cmd.includes('exec') && cmd.includes('wget')) {
      return JSON.stringify({ result: '0x1' });
    }
    return setupFullSuccessMocks_passthrough(cmd);
  });

  await zeroDowntimeScale(2, 4, testConfig);

  // 준비 체크 단계에서 jsonpath 호출이 1번만 있어야 함 (2번 아님)
  const readyCheckCmds = kubectlCmds.filter(c =>
    c.includes('get pod') && c.includes('jsonpath')
  );
  // 각 폴링 시도마다 정확히 1개의 jsonpath 호출 (통합), 2개가 아님
  expect(readyCheckCmds.every(c => c.includes('podIP'))).toBe(true);
});
```

**Step 2: 테스트 실패 확인**

실행: `npx vitest run src/lib/__tests__/zero-downtime-scaler.test.ts -t "single kubectl"`
예상: FAIL — 별도 호출 존재

**Step 3: 통합 kubectl 구현**

`src/lib/zero-downtime-scaler.ts`에서 279-303번 줄(3개의 별도 kubectl 호출)을 교체합니다:

```typescript
// Ready + PodIP 통합 단일 호출
const combined = await runK8sCommand(
  `get pod ${podName} -n ${namespace} -o jsonpath='{.status.conditions[?(@.type=="Ready")].status},{.status.podIP}'`,
  { timeout: 10000 }
);
const [readyStatus, podIP] = combined.replace(/'/g, '').trim().split(',');

if (readyStatus !== 'True' || !podIP) {
  continue;
}

// RPC 활성 체크 (파드 준비 후에만 실행)
const rpcCheckTimeoutMs = parseInt(process.env.RPC_CHECK_TIMEOUT_MS || '15000', 10);
const rpcResponse = await runK8sCommand(
  `exec ${podName} -n ${namespace} -- wget -qO- --timeout=5 http://localhost:8545 --post-data='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`,
  { timeout: rpcCheckTimeoutMs }
);
const parsed = JSON.parse(rpcResponse);
if (parsed.result) {
  const blockNumber = parseInt(parsed.result, 16);
  return { ready: true, blockNumber };
}
```

**Step 4: 테스트 실행**

실행: `npx vitest run src/lib/__tests__/zero-downtime-scaler.test.ts`
예상: ALL PASS (필요 시 `setupFullSuccessMocks`의 mock을 통합 형식으로 업데이트)

**Step 5: 커밋**

```bash
git add src/lib/zero-downtime-scaler.ts src/lib/__tests__/zero-downtime-scaler.test.ts
git commit -m "perf(zero-downtime): consolidate 3 kubectl calls to 1+1 per poll"
```

---

## Task 3: Zero-Downtime Phase 2 — 부분 롤백

**관련 파일:**
- 수정: `src/lib/zero-downtime-scaler.ts:335-379` (switchTraffic 에러 처리)
- 테스트: `src/lib/__tests__/zero-downtime-scaler.test.ts`

**배경:**
`switchTraffic()`은 라벨링 실패 시 복구 로직이 없습니다. 새 파드에 `slot=active`가 붙었는데 이전 파드 라벨 변경이 실패하면 두 파드 모두 active 상태가 될 수 있습니다. 부분 롤백을 추가합니다: 오류 발생 시 이전 파드를 다시 active로 재라벨링합니다.

**Step 1: 실패하는 테스트 작성**

```typescript
it('should partial-rollback on traffic switch label failure', async () => {
  let labelAttempts = 0;
  mockRunK8sCommand.mockImplementation(async (cmd: string) => {
    // Phase 1-2는 정상 성공
    if (cmd.includes('apply') || cmd.includes('jsonpath')) {
      return setupFullSuccessMocks_passthrough(cmd);
    }
    // Phase 3: 트래픽 전환
    if (cmd.includes('label') && cmd.includes('slot=draining')) {
      // draining 라벨 실패 (이전 파드)
      throw new Error('kubectl label failed: connection refused');
    }
    if (cmd.includes('label') && cmd.includes('slot=active')) {
      labelAttempts++;
      return 'labeled';
    }
    return setupFullSuccessMocks_passthrough(cmd);
  });

  const result = await zeroDowntimeScale(2, 4, testConfig);

  // 복구 시도 확인 (이전 파드 active 재라벨링)
  expect(labelAttempts).toBeGreaterThanOrEqual(2); // 초기 + 복구
  expect(result.success).toBe(false);
});
```

**Step 2: 테스트 실패 확인**

실행: `npx vitest run src/lib/__tests__/zero-downtime-scaler.test.ts -t "partial-rollback"`
예상: FAIL

**Step 3: 부분 롤백 구현**

`src/lib/zero-downtime-scaler.ts`에서 트래픽 전환 라벨 작업(362-371번 줄)을 try-catch와 복구 로직으로 감쌉니다:

```typescript
// standby 파드를 active로 라벨링
await runK8sCommand(
  `label pod ${standbyPodName} -n ${namespace} slot=active --overwrite`,
  { timeout: 10000 }
);

try {
  // 이전 파드를 draining으로 라벨링
  await runK8sCommand(
    `label pod ${oldPodName} -n ${namespace} slot=draining --overwrite`,
    { timeout: 10000 }
  );
} catch (err) {
  logger.error('[ZeroDowntime] Failed to label old pod as draining, rolling back', { error: err });
  // 복구: 이전 파드를 active로 재라벨링, standby의 active 라벨 제거
  try {
    await runK8sCommand(
      `label pod ${oldPodName} -n ${namespace} slot=active --overwrite`,
      { timeout: 10000 }
    );
    await runK8sCommand(
      `label pod ${standbyPodName} -n ${namespace} slot=standby --overwrite`,
      { timeout: 10000 }
    );
    logger.info('[ZeroDowntime] Partial rollback successful');
  } catch (rollbackErr) {
    logger.error('[ZeroDowntime] Partial rollback also failed', { error: rollbackErr });
  }
  return { success: false, previousSelector: {}, newSelector: {}, serviceName };
}
```

**Step 4: 테스트 실행**

실행: `npx vitest run src/lib/__tests__/zero-downtime-scaler.test.ts`
예상: ALL PASS

**Step 5: 커밋**

```bash
git add src/lib/zero-downtime-scaler.ts src/lib/__tests__/zero-downtime-scaler.test.ts
git commit -m "feat(zero-downtime): partial rollback on traffic switch failure"
```

---

## Task 4: NLOps 툴 병렬화

**관련 파일:**
- 수정: `src/lib/nlops-engine.ts:549-552` (순차 툴 루프 → Promise.allSettled)
- 테스트: `src/lib/__tests__/nlops-engine.test.ts`

**배경:**
NLOps `processCommand()`는 549-552번 줄에서 for-loop으로 툴을 순차 실행합니다. `get_metrics` + `get_anomalies`처럼 독립적인 여러 툴은 병렬로 실행해야 합니다. 위험한 툴(`scale_node`, `update_config`)은 이 시점 이전에 이미 확인 흐름으로 차단되므로 병렬화가 안전합니다.

**Step 1: 실패하는 테스트 작성**

```typescript
it('should execute multiple tools in parallel', async () => {
  const executionOrder: { tool: string; time: number }[] = [];
  const startTime = Date.now();

  // 각각 ~50ms 소요되는 2개 툴 호출 mock
  mockFetch.mockImplementation(async (url: string) => {
    const toolName = url.includes('metrics') ? 'get_metrics' : 'get_anomalies';
    await new Promise(r => setTimeout(r, 50));
    executionOrder.push({ tool: toolName, time: Date.now() - startTime });
    return new Response(JSON.stringify({ success: true }));
  });

  mockPlanResponse([
    { name: 'get_metrics', params: {} },
    { name: 'get_anomalies', params: {} },
  ]);

  const result = await processCommand('show metrics and anomalies', 'http://localhost:3002');

  // 병렬이면 두 툴 모두 ~50ms 총 소요 (순차이면 ~100ms)
  expect(executionOrder.length).toBe(2);
  // 두 툴이 20ms 이내에 거의 동시에 시작되어야 함 (병렬)
  const timeDiff = Math.abs(executionOrder[0].time - executionOrder[1].time);
  expect(timeDiff).toBeLessThan(40); // 병렬: 거의 동시
});
```

**Step 2: 테스트 실패 확인**

실행: `npx vitest run src/lib/__tests__/nlops-engine.test.ts -t "parallel"`
예상: FAIL — timeDiff가 ~50ms (순차)

**Step 3: 병렬 실행 구현**

`src/lib/nlops-engine.ts`에서 549-552번 줄을 교체합니다:

```typescript
// Before:
for (const tc of toolCalls) {
  const data = await executeTool(tc.name, tc.params, baseUrl);
  toolResults.push({ name: tc.name, data });
}

// After:
const toolPromises = toolCalls.map(tc =>
  executeTool(tc.name, tc.params, baseUrl)
    .then(data => ({ name: tc.name, data }))
    .catch(err => ({ name: tc.name, data: { error: err.message } }))
);
const toolResults = await Promise.all(toolPromises);

const failedTools = toolResults.filter(r => r.data?.error);
if (failedTools.length > 0) {
  logger.warn('[NLOps] Some tools failed', {
    failed: failedTools.map(r => ({ name: r.name, error: r.data.error })),
  });
}
```

**Step 4: 테스트 실행**

실행: `npx vitest run src/lib/__tests__/nlops-engine.test.ts`
예상: ALL PASS (부분 실패에 대한 기존 테스트는 에러 형태가 유지되므로 계속 통과)

**Step 5: 커밋**

```bash
git add src/lib/nlops-engine.ts src/lib/__tests__/nlops-engine.test.ts
git commit -m "perf(nlops): parallelize tool execution with Promise.all"
```

---

## Task 5: RCA 이력 Redis 마이그레이션

**관련 파일:**
- 수정: `src/lib/rca-engine.ts:57-65,531-565` (인메모리 배열 → IStateStore)
- 수정: `src/types/redis.ts` (IStateStore에 RCA 이력 메서드 추가)
- 수정: `src/lib/redis-store.ts` (RedisStateStore 및 InMemoryStateStore에 구현)
- 테스트: `src/lib/__tests__/rca-engine.test.ts:219-309`

**배경:**
RCA 이력은 전역 `let rcaHistory: RCAHistoryEntry[] = []` (63번 줄)에 저장됩니다. 최대 20개. 프로세스 재시작 시 모든 이력이 사라집니다. Redis 배포에서 재시작 후에도 이력이 영속되도록 IStateStore로 마이그레이션합니다.

**Step 1: IStateStore 메서드 추가**

`src/types/redis.ts`에 IStateStore 인터페이스를 추가합니다 (기존 prediction tracker 섹션 이후, ~181번 줄):

```typescript
// RCA 이력
addRCAHistory(entry: RCAHistoryEntry): Promise<void>;
getRCAHistory(limit?: number): Promise<RCAHistoryEntry[]>;
getRCAById(id: string): Promise<RCAHistoryEntry | undefined>;
getRCAHistoryCount(): Promise<number>;
```

`src/types/redis.ts` 상단에 타입 import를 추가합니다:
```typescript
import type { RCAHistoryEntry } from './rca';
```

**Step 2: RedisStateStore 구현**

`src/lib/redis-store.ts`의 RedisStateStore 클래스에 추가합니다 (prediction tracker 메서드 이후, ~762번 줄):

```typescript
// --- RCA 이력 ---
private readonly RCA_HISTORY_MAX = 100;
private readonly RCA_HISTORY_TTL = 7 * 24 * 60 * 60; // 7일

async addRCAHistory(entry: RCAHistoryEntry): Promise<void> {
  const data = JSON.stringify(entry);
  await this.client.lpush(this.key('rca:history'), data);
  await this.client.ltrim(this.key('rca:history'), 0, this.RCA_HISTORY_MAX - 1);
  await this.client.expire(this.key('rca:history'), this.RCA_HISTORY_TTL);
}

async getRCAHistory(limit: number = 20): Promise<RCAHistoryEntry[]> {
  const items = await this.client.lrange(this.key('rca:history'), 0, limit - 1);
  return items.map(item => JSON.parse(item));
}

async getRCAById(id: string): Promise<RCAHistoryEntry | undefined> {
  const all = await this.client.lrange(this.key('rca:history'), 0, this.RCA_HISTORY_MAX - 1);
  for (const item of all) {
    const entry: RCAHistoryEntry = JSON.parse(item);
    if (entry.id === id) return entry;
  }
  return undefined;
}

async getRCAHistoryCount(): Promise<number> {
  return this.client.llen(this.key('rca:history'));
}
```

**Step 3: InMemoryStateStore 구현**

같은 파일의 InMemoryStateStore 클래스에 추가합니다:

```typescript
private rcaHistory: RCAHistoryEntry[] = [];

async addRCAHistory(entry: RCAHistoryEntry): Promise<void> {
  this.rcaHistory.unshift(entry);
  if (this.rcaHistory.length > 100) this.rcaHistory.pop();
}

async getRCAHistory(limit: number = 20): Promise<RCAHistoryEntry[]> {
  return this.rcaHistory.slice(0, limit);
}

async getRCAById(id: string): Promise<RCAHistoryEntry | undefined> {
  return this.rcaHistory.find(e => e.id === id);
}

async getRCAHistoryCount(): Promise<number> {
  return this.rcaHistory.length;
}
```

**Step 4: rca-engine.ts 업데이트**

`src/lib/rca-engine.ts`:

1. 63번 줄 삭제: `let rcaHistory: RCAHistoryEntry[] = [];`
2. import 추가: `import { getStore } from '@/lib/redis-store';`
3. 이력 함수 교체 (531-565번 줄):

```typescript
export async function addRCAHistory(entry: RCAHistoryEntry): Promise<void> {
  const store = getStore();
  await store.addRCAHistory(entry);
}

export async function getRCAHistory(limit?: number): Promise<RCAHistoryEntry[]> {
  const store = getStore();
  return store.getRCAHistory(limit);
}

export async function getRCAById(id: string): Promise<RCAHistoryEntry | undefined> {
  const store = getStore();
  return store.getRCAById(id);
}

export async function getRCAHistoryCount(): Promise<number> {
  const store = getStore();
  return store.getRCAHistoryCount();
}
```

**Step 5: 테스트 실행**

실행: `npx vitest run src/lib/__tests__/rca-engine.test.ts`
예상: ALL PASS (동작 변경 없음, 저장 백엔드만 변경)

**Step 6: 커밋**

```bash
git add src/types/redis.ts src/lib/redis-store.ts src/lib/rca-engine.ts src/lib/__tests__/rca-engine.test.ts
git commit -m "feat(rca): migrate history from in-memory to IStateStore (Redis/InMemory)"
```

---

## Task 6: 예측 정확도 추적

**관련 파일:**
- 수정: `src/lib/predictive-scaler.ts:214-275` (예측 검증 후 정확도 기록 추가)
- 수정: `src/types/redis.ts` (IStateStore에 prediction tracker 메서드가 이미 176-181번 줄에 있음)
- 테스트: `src/lib/__tests__/predictive-scaler.test.ts`

**배경:**
`PredictionRecord` 타입은 `src/types/prediction.ts:84-99`에 이미 정의되어 있습니다: `id`, `prediction`, `actualVcpu?`, `wasAccurate?`, `verifiedAt?`. IStateStore에는 이미 `addPredictionRecord`, `updatePredictionRecord`, `getPredictionRecords`가 있습니다. 스토어 구현도 이미 존재합니다. 예측 → 기록 → 검증 연결만 하면 됩니다.

**Step 1: 실패하는 테스트 작성**

```typescript
it('should record prediction for later accuracy verification', async () => {
  // AI가 예측을 반환하도록 mock
  mockChatCompletion.mockResolvedValueOnce('{"predictedVcpu":4,"confidence":0.85,"trend":"rising","reasoning":"test","recommendedAction":"scale_up","predictionWindow":"5min","factors":[]}');

  const result = await predictScaling(mockMetrics);

  // 예측이 store에 기록되었는지 확인
  const store = getStore();
  const records = await store.getPredictionRecords(1);
  expect(records.length).toBe(1);
  expect(records[0].prediction.predictedVcpu).toBe(4);
  expect(records[0].actualVcpu).toBeUndefined(); // 아직 검증 전
});
```

**Step 2: 테스트 실패 확인**

실행: `npx vitest run src/lib/__tests__/predictive-scaler.test.ts -t "record prediction"`
예상: FAIL — 기록 없음

**Step 3: 예측 기록 구현**

`src/lib/predictive-scaler.ts`에서 성공적인 예측 반환 이후(약 260번 줄)에 추가합니다:

```typescript
// 정확도 추적을 위한 예측 기록
const predictionRecord: PredictionRecord = {
  id: `pred-${Date.now()}`,
  prediction: result,
};
await store.addPredictionRecord(predictionRecord);
```

`@/types/prediction`에서 `PredictionRecord` import를 추가합니다.

**Step 4: 검증 함수 추가**

스케일링 실행 후 agent-loop에서 호출하는 새 함수를 export합니다:

```typescript
export async function verifyPredictionAccuracy(
  actualVcpu: TargetVcpu
): Promise<void> {
  const store = getStore();
  const records = await store.getPredictionRecords(1);
  if (records.length === 0) return;

  const latest = records[0];
  if (latest.verifiedAt) return; // 이미 검증됨

  const wasAccurate = latest.prediction.predictedVcpu === actualVcpu;
  await store.updatePredictionRecord(latest.id, {
    actualVcpu,
    wasAccurate,
    verifiedAt: new Date().toISOString(),
  });

  logger.info('[Prediction] Accuracy verified', {
    predicted: latest.prediction.predictedVcpu,
    actual: actualVcpu,
    accurate: wasAccurate,
  });
}
```

**Step 5: 검증 테스트 작성**

```typescript
it('should verify prediction accuracy when actual vCPU is known', async () => {
  const store = getStore();
  await store.addPredictionRecord({
    id: 'pred-test',
    prediction: { predictedVcpu: 4, confidence: 0.85 } as PredictionResult,
  });

  await verifyPredictionAccuracy(4);

  const records = await store.getPredictionRecords(1);
  expect(records[0].wasAccurate).toBe(true);
  expect(records[0].verifiedAt).toBeDefined();
});
```

**Step 6: 모든 테스트 실행**

실행: `npx vitest run src/lib/__tests__/predictive-scaler.test.ts`
예상: ALL PASS

**Step 7: 커밋**

```bash
git add src/lib/predictive-scaler.ts src/lib/__tests__/predictive-scaler.test.ts
git commit -m "feat(prediction): record predictions and verify accuracy via IStateStore"
```

---

## Task 7: Trace ID 기반 요청 추적

**관련 파일:**
- 생성: `src/lib/trace-context.ts` (Trace ID 생성 및 전파)
- 수정: `src/app/api/metrics/route.ts` (trace 헤더 추가)
- 수정: `src/lib/rca-engine.ts` (traceId 수신 및 로깅)
- 수정: `src/lib/scaling-decision.ts` (traceId 수신 및 로깅)
- 수정: `src/lib/anomaly-detector.ts` (traceId 수신 및 로깅)
- 테스트: `src/lib/__tests__/trace-context.test.ts`

**배경:**
현재 API → 이상 감지 → RCA → 스케일링 결정까지 요청을 추적할 방법이 없습니다. v2 에이전트 시스템은 이미 AgentEvent에 `correlationId`를 사용합니다. v1 API 파이프라인과 v2 에이전트 파이프라인 모두에서 작동하는 경량 trace context를 만듭니다.

**Step 1: 테스트 작성**

`src/lib/__tests__/trace-context.test.ts` 생성:

```typescript
import { describe, it, expect } from 'vitest';
import { generateTraceId, withTraceId, getTraceId } from '@/lib/trace-context';

describe('trace-context', () => {
  it('should generate unique trace IDs', () => {
    const id1 = generateTraceId();
    const id2 = generateTraceId();
    expect(id1).toMatch(/^tr-[a-z0-9]+$/);
    expect(id2).toMatch(/^tr-[a-z0-9]+$/);
    expect(id1).not.toBe(id2);
  });

  it('should propagate trace ID via AsyncLocalStorage', async () => {
    const traceId = 'tr-test123';
    let captured: string | undefined;

    await withTraceId(traceId, async () => {
      captured = getTraceId();
    });

    expect(captured).toBe(traceId);
  });

  it('should return undefined outside trace context', () => {
    expect(getTraceId()).toBeUndefined();
  });
});
```

**Step 2: 테스트 실패 확인**

실행: `npx vitest run src/lib/__tests__/trace-context.test.ts`
예상: FAIL — 모듈 없음

**Step 3: trace context 구현**

`src/lib/trace-context.ts` 생성:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

interface TraceContext {
  traceId: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

export function generateTraceId(): string {
  return `tr-${randomBytes(8).toString('hex')}`;
}

export function withTraceId<T>(traceId: string, fn: () => T | Promise<T>): T | Promise<T> {
  return traceStorage.run({ traceId }, fn);
}

export function getTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId;
}
```

**Step 4: 테스트 실행**

실행: `npx vitest run src/lib/__tests__/trace-context.test.ts`
예상: PASS

**Step 5: metrics API 라우트에 Trace ID 추가**

`src/app/api/metrics/route.ts`에서 GET 핸들러 상단에:

```typescript
import { generateTraceId, withTraceId } from '@/lib/trace-context';

export async function GET(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') || generateTraceId();

  return withTraceId(traceId, async () => {
    // ... 기존 핸들러 본문 ...
    const response = NextResponse.json(data);
    response.headers.set('x-trace-id', traceId);
    return response;
  });
}
```

**Step 6: 로거 출력에 Trace ID 추가**

`src/lib/logger.ts`에서 `writeLog`가 traceId를 포함하도록 수정합니다:

```typescript
import { getTraceId } from '@/lib/trace-context';

// writeLog 또는 wrapLogger에서 traceId를 로그 바인딩에 추가:
const traceId = getTraceId();
if (traceId) {
  target[level]({ traceId }, formatted);
} else {
  target[level](formatted);
}
```

**Step 7: 전체 테스트 실행**

실행: `npx vitest run src/lib/__tests__/trace-context.test.ts`
예상: ALL PASS

**Step 8: 커밋**

```bash
git add src/lib/trace-context.ts src/lib/__tests__/trace-context.test.ts src/app/api/metrics/route.ts src/lib/logger.ts
git commit -m "feat(observability): trace ID context propagation via AsyncLocalStorage"
```

---

## Task 8: Experience Store (경험 저장소)

**관련 파일:**
- 생성: `src/lib/experience-store.ts`
- 수정: `src/types/redis.ts` (IStateStore에 experience store 메서드 추가)
- 수정: `src/lib/redis-store.ts` (experience 메서드 구현)
- 테스트: `src/lib/__tests__/experience-store.test.ts`

**배경:**
Experience Store는 VerifierAgent 결과(`verification-complete` EventBus 이벤트)에서 운영 이벤트를 캡처하고 메트릭 컨텍스트로 보강합니다. 이것이 Agent-for-Hire 모델의 기반입니다 — 에이전트는 시간이 지남에 따라 검증 가능한 경험을 축적합니다. 기존 OperationLedger(`src/core/playbook-system/store.ts`)와 IStateStore 패턴을 기반으로 구축됩니다.

플레이북 시스템은 이미 인스턴스당 `OperationRecord`를 저장합니다. Experience Store는 이를 다음을 포함하는 **ExperienceEntry** 레코드로 집계합니다:
- 운영 결과 (VerifierAgent 출력)
- 메트릭 컨텍스트 (InstanceMetricsStore)
- 프로토콜 유형 (인스턴스 레지스트리)
- 패턴 카테고리 (트리거 시그니처)

**Step 1: 타입 정의**

`src/types/experience.ts` 생성:

```typescript
export interface ExperienceEntry {
  id: string;
  instanceId: string;
  protocolId: string;
  timestamp: string;
  category: 'anomaly-resolution' | 'scaling-action' | 'rca-diagnosis' | 'remediation';
  trigger: {
    type: string;         // 예: 'z-score', 'threshold', 'plateau'
    metric: string;       // 예: 'cpuUsage', 'gasUsedRatio'
    value: number;
  };
  action: string;           // 수행한 작업
  outcome: 'success' | 'failure' | 'partial';
  resolutionMs: number;
  metricsSnapshot: Record<string, number>;  // 이벤트 시점의 핵심 메트릭
  traceId?: string;
}

export interface ExperienceStats {
  totalOperations: number;
  successRate: number;
  avgResolutionMs: number;
  topCategories: { category: string; count: number }[];
  operatingDays: number;
}
```

**Step 2: IStateStore 메서드 추가**

`src/types/redis.ts`에 IStateStore 인터페이스를 추가합니다:

```typescript
// Experience Store
addExperience(entry: ExperienceEntry): Promise<void>;
getExperience(limit?: number, offset?: number): Promise<ExperienceEntry[]>;
getExperienceByInstance(instanceId: string, limit?: number): Promise<ExperienceEntry[]>;
getExperienceCount(): Promise<number>;
getExperienceStats(): Promise<ExperienceStats>;
```

**Step 3: 양쪽 스토어 구현**

RedisStateStore — LPUSH + LRANGE 리스트 패턴 사용 (RCA 이력과 동일).
InMemoryStateStore — push/slice를 사용한 배열.

키 상수: `EXPERIENCE_MAX = 5000`, `EXPERIENCE_TTL = 90 * 24 * 60 * 60` (90일).

**Step 4: 테스트 작성**

`src/lib/__tests__/experience-store.test.ts` 생성:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { recordExperience, getExperienceLog, getExperienceStats } from '@/lib/experience-store';

describe('experience-store', () => {
  beforeEach(async () => {
    // store 초기화
  });

  it('should record an experience entry', async () => {
    await recordExperience({
      instanceId: 'inst-1',
      protocolId: 'opstack',
      category: 'scaling-action',
      trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 },
      action: 'scale_up 2→4 vCPU',
      outcome: 'success',
      resolutionMs: 45000,
      metricsSnapshot: { cpuUsage: 85, gasUsedRatio: 0.7 },
    });

    const log = await getExperienceLog(10);
    expect(log.length).toBe(1);
    expect(log[0].category).toBe('scaling-action');
    expect(log[0].outcome).toBe('success');
  });

  it('should calculate experience stats', async () => {
    // 3개 항목 추가: 성공 2개, 실패 1개
    await recordExperience({ /* success */ });
    await recordExperience({ /* success */ });
    await recordExperience({ /* failure */ });

    const stats = await getExperienceStats();
    expect(stats.totalOperations).toBe(3);
    expect(stats.successRate).toBeCloseTo(0.667, 2);
  });
});
```

**Step 5: experience-store.ts 구현**

`src/lib/experience-store.ts` 생성:

```typescript
import { getStore } from '@/lib/redis-store';
import { getTraceId } from '@/lib/trace-context';
import { randomUUID } from 'node:crypto';
import type { ExperienceEntry, ExperienceStats } from '@/types/experience';

export async function recordExperience(
  input: Omit<ExperienceEntry, 'id' | 'timestamp' | 'traceId'>
): Promise<ExperienceEntry> {
  const entry: ExperienceEntry = {
    ...input,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    traceId: getTraceId(),
  };
  const store = getStore();
  await store.addExperience(entry);
  return entry;
}

export async function getExperienceLog(
  limit: number = 50,
  offset: number = 0
): Promise<ExperienceEntry[]> {
  const store = getStore();
  return store.getExperience(limit, offset);
}

export async function getExperienceStats(): Promise<ExperienceStats> {
  const store = getStore();
  return store.getExperienceStats();
}
```

**Step 6: 테스트 실행**

실행: `npx vitest run src/lib/__tests__/experience-store.test.ts`
예상: ALL PASS

**Step 7: 커밋**

```bash
git add src/types/experience.ts src/lib/experience-store.ts src/lib/__tests__/experience-store.test.ts src/types/redis.ts src/lib/redis-store.ts
git commit -m "feat(experience): experience store for operational knowledge accumulation"
```

---

## Task 9: Pattern Extractor (패턴 추출기)

**관련 파일:**
- 생성: `src/lib/pattern-extractor.ts`
- 생성: `src/types/pattern.ts`
- 테스트: `src/lib/__tests__/pattern-extractor.test.ts`

**배경:**
Pattern Extractor는 ExperienceEntry 레코드를 분석하여 반복 가능한 운영 패턴을 발견합니다. 기존 `incident-analyzer.ts`(`src/core/playbook-system/incident-analyzer.ts`)를 기반으로 구축되며, 이미 트리거 시그니처별로 OperationRecord를 그룹화합니다. Pattern Extractor는 더 높은 수준에서 작동합니다: Experience Store에서 인스턴스 간, 시간 간 패턴을 식별합니다.

**패턴이란:** "트리거 조건이 발생했을 때, 특정 액션을 취하면 N번의 발생에서 성공률이 [x]%이다."

**Step 1: 타입 정의**

`src/types/pattern.ts` 생성:

```typescript
export interface OperationalPattern {
  id: string;
  signature: string;          // 예: "z-score|cpuUsage|3.0-4.0|scale_up"
  description: string;        // 사람이 읽을 수 있는 설명
  trigger: {
    type: string;
    metric: string;
    valueRange: [number, number];
  };
  action: string;
  occurrences: number;
  successRate: number;         // 0-1
  avgResolutionMs: number;
  confidence: number;          // 0-1 (발생 횟수 + 성공률 기반)
  protocols: string[];         // 이 패턴이 적용되는 프로토콜 유형
  firstSeen: string;
  lastSeen: string;
}

export interface PatternExtractionResult {
  patterns: OperationalPattern[];
  totalExperienceAnalyzed: number;
  extractedAt: string;
}
```

**Step 2: 테스트 작성**

`src/lib/__tests__/pattern-extractor.test.ts` 생성:

```typescript
import { describe, it, expect } from 'vitest';
import { extractPatterns } from '@/lib/pattern-extractor';
import type { ExperienceEntry } from '@/types/experience';

describe('pattern-extractor', () => {
  const makeEntry = (overrides: Partial<ExperienceEntry> = {}): ExperienceEntry => ({
    id: `exp-${Math.random()}`,
    instanceId: 'inst-1',
    protocolId: 'opstack',
    timestamp: new Date().toISOString(),
    category: 'scaling-action',
    trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 },
    action: 'scale_up',
    outcome: 'success',
    resolutionMs: 45000,
    metricsSnapshot: { cpuUsage: 85 },
    ...overrides,
  });

  it('should extract pattern from repeated similar experiences', () => {
    const entries = [
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.2 } }),
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.7 } }),
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 } }),
    ];

    const result = extractPatterns(entries);
    expect(result.patterns.length).toBe(1);
    expect(result.patterns[0].occurrences).toBe(3);
    expect(result.patterns[0].successRate).toBe(1.0);
    expect(result.patterns[0].trigger.metric).toBe('cpuUsage');
  });

  it('should require minimum 3 occurrences for a pattern', () => {
    const entries = [makeEntry(), makeEntry()]; // 2개만
    const result = extractPatterns(entries);
    expect(result.patterns.length).toBe(0);
  });

  it('should calculate confidence from occurrences and success rate', () => {
    const entries = [
      makeEntry({ outcome: 'success' }),
      makeEntry({ outcome: 'success' }),
      makeEntry({ outcome: 'failure' }),
      makeEntry({ outcome: 'success' }),
    ];

    const result = extractPatterns(entries);
    expect(result.patterns[0].confidence).toBeGreaterThan(0);
    expect(result.patterns[0].confidence).toBeLessThan(1);
    expect(result.patterns[0].successRate).toBe(0.75);
  });

  it('should track multiple protocols in a pattern', () => {
    const entries = [
      makeEntry({ protocolId: 'opstack' }),
      makeEntry({ protocolId: 'opstack' }),
      makeEntry({ protocolId: 'arbitrum' }),
    ];

    const result = extractPatterns(entries);
    expect(result.patterns[0].protocols).toContain('opstack');
    expect(result.patterns[0].protocols).toContain('arbitrum');
  });
});
```

**Step 3: 구현**

`src/lib/pattern-extractor.ts` 생성:

```typescript
import type { ExperienceEntry } from '@/types/experience';
import type { OperationalPattern, PatternExtractionResult } from '@/types/pattern';
import { randomUUID } from 'node:crypto';

const MIN_OCCURRENCES = 3;

function buildSignature(entry: ExperienceEntry): string {
  const valueBucket = Math.floor(entry.trigger.value);
  return `${entry.trigger.type}|${entry.trigger.metric}|${valueBucket}|${entry.action}`;
}

export function extractPatterns(
  entries: ExperienceEntry[],
  minOccurrences: number = MIN_OCCURRENCES
): PatternExtractionResult {
  // 시그니처별 그룹화
  const groups = new Map<string, ExperienceEntry[]>();
  for (const entry of entries) {
    const sig = buildSignature(entry);
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig)!.push(entry);
  }

  const patterns: OperationalPattern[] = [];

  for (const [signature, group] of groups) {
    if (group.length < minOccurrences) continue;

    const successes = group.filter(e => e.outcome === 'success').length;
    const successRate = successes / group.length;
    const avgResolutionMs = group.reduce((s, e) => s + e.resolutionMs, 0) / group.length;
    const protocols = [...new Set(group.map(e => e.protocolId))];
    const values = group.map(e => e.trigger.value);
    const confidence = Math.min(1, (Math.log2(group.length) / 5) * successRate);

    const sorted = group.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    patterns.push({
      id: randomUUID(),
      signature,
      description: `${group[0].trigger.metric}의 ${group[0].trigger.type}가 트리거될 때 (${Math.min(...values).toFixed(1)}-${Math.max(...values).toFixed(1)}), ${group[0].action}의 성공률은 ${(successRate * 100).toFixed(0)}%입니다`,
      trigger: {
        type: group[0].trigger.type,
        metric: group[0].trigger.metric,
        valueRange: [Math.min(...values), Math.max(...values)],
      },
      action: group[0].action,
      occurrences: group.length,
      successRate,
      avgResolutionMs,
      confidence,
      protocols,
      firstSeen: sorted[0].timestamp,
      lastSeen: sorted[sorted.length - 1].timestamp,
    });
  }

  return {
    patterns: patterns.sort((a, b) => b.confidence - a.confidence),
    totalExperienceAnalyzed: entries.length,
    extractedAt: new Date().toISOString(),
  };
}
```

**Step 4: 테스트 실행**

실행: `npx vitest run src/lib/__tests__/pattern-extractor.test.ts`
예상: ALL PASS

**Step 5: 커밋**

```bash
git add src/types/pattern.ts src/lib/pattern-extractor.ts src/lib/__tests__/pattern-extractor.test.ts
git commit -m "feat(patterns): pattern extractor from operational experience"
```

---

## Task 10: Agent Resume Generator (에이전트 이력서 생성기)

**관련 파일:**
- 생성: `src/lib/agent-resume.ts`
- 생성: `src/types/agent-resume.ts`
- 생성: `src/app/api/v2/instances/[id]/resume/route.ts`
- 테스트: `src/lib/__tests__/agent-resume.test.ts`

**배경:**
Agent Resume는 에이전트의 운영 경험에 대한 공개적 증명서입니다. Experience Store(Task 8)와 Pattern Extractor(Task 9)에서 읽어 구조화된 프로파일을 생성합니다. 이것이 운영자가 채용 전 보게 되는 에이전트의 "CV"입니다.

**경험 티어 분류:**
- Trainee: 운영 30일 미만
- Junior: 30~90일
- Senior: 90~180일
- Expert: 180일 이상

**Step 1: 타입 정의**

`src/types/agent-resume.ts` 생성:

```typescript
import type { ExperienceStats } from './experience';
import type { OperationalPattern } from './pattern';

export type ExperienceTier = 'trainee' | 'junior' | 'senior' | 'expert';

export interface AgentResume {
  instanceId: string;
  protocolId: string;
  tier: ExperienceTier;
  operatingSince: string;              // ISO 날짜
  stats: ExperienceStats;
  topPatterns: OperationalPattern[];   // confidence 기준 상위 5개
  specialties: string[];               // 패턴 카테고리에서 도출
  generatedAt: string;
}
```

**Step 2: 테스트 작성**

`src/lib/__tests__/agent-resume.test.ts` 생성:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateResume, calculateTier } from '@/lib/agent-resume';

describe('agent-resume', () => {
  describe('calculateTier', () => {
    it('should return trainee for < 30 days', () => {
      expect(calculateTier(15)).toBe('trainee');
    });

    it('should return junior for 30-90 days', () => {
      expect(calculateTier(45)).toBe('junior');
    });

    it('should return senior for 90-180 days', () => {
      expect(calculateTier(120)).toBe('senior');
    });

    it('should return expert for 180+ days', () => {
      expect(calculateTier(200)).toBe('expert');
    });
  });

  describe('generateResume', () => {
    it('should generate a complete resume from experience data', async () => {
      const resume = await generateResume('inst-1', 'opstack');

      expect(resume.instanceId).toBe('inst-1');
      expect(resume.protocolId).toBe('opstack');
      expect(resume.tier).toBeDefined();
      expect(resume.stats).toBeDefined();
      expect(resume.generatedAt).toBeDefined();
    });
  });
});
```

**Step 3: 구현**

`src/lib/agent-resume.ts` 생성:

```typescript
import { getExperienceLog, getExperienceStats } from '@/lib/experience-store';
import { extractPatterns } from '@/lib/pattern-extractor';
import type { AgentResume, ExperienceTier } from '@/types/agent-resume';

export function calculateTier(operatingDays: number): ExperienceTier {
  if (operatingDays >= 180) return 'expert';
  if (operatingDays >= 90) return 'senior';
  if (operatingDays >= 30) return 'junior';
  return 'trainee';
}

export async function generateResume(
  instanceId: string,
  protocolId: string
): Promise<AgentResume> {
  const stats = await getExperienceStats();
  const entries = await getExperienceLog(500);
  const instanceEntries = entries.filter(e => e.instanceId === instanceId);
  const { patterns } = extractPatterns(instanceEntries);

  const topPatterns = patterns.slice(0, 5);
  const specialties = [...new Set(topPatterns.map(p => p.trigger.metric))];

  return {
    instanceId,
    protocolId,
    tier: calculateTier(stats.operatingDays),
    operatingSince: instanceEntries.length > 0
      ? instanceEntries[instanceEntries.length - 1].timestamp
      : new Date().toISOString(),
    stats,
    topPatterns,
    specialties,
    generatedAt: new Date().toISOString(),
  };
}
```

**Step 4: API 라우트 생성**

`src/app/api/v2/instances/[id]/resume/route.ts` 생성:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { generateResume } from '@/lib/agent-resume';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: instanceId } = await params;

  try {
    // 기본값은 opstack; 프로덕션에서는 인스턴스 레지스트리에서 조회
    const resume = await generateResume(instanceId, 'opstack');
    return NextResponse.json(resume);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate resume' },
      { status: 500 }
    );
  }
}
```

**Step 5: 테스트 실행**

실행: `npx vitest run src/lib/__tests__/agent-resume.test.ts`
예상: ALL PASS

**Step 6: 커밋**

```bash
git add src/types/agent-resume.ts src/lib/agent-resume.ts src/lib/__tests__/agent-resume.test.ts src/app/api/v2/instances/[id]/resume/route.ts
git commit -m "feat(resume): agent resume generator with tier calculation and API"
```

---

## Task 11: Outcome Tracker (결과 추적기)

**관련 파일:**
- 생성: `src/lib/outcome-tracker.ts`
- 생성: `src/types/billing.ts`
- 테스트: `src/lib/__tests__/outcome-tracker.test.ts`

**배경:**
Outcome Tracker는 VerifierAgent의 `verification-complete` 이벤트를 수신하고, 결과를 분류하며, 빌링 이벤트를 발행합니다. 운영 이벤트와 수익 사이의 연결고리입니다 — 각 검증된 결과는 성과 기반 가격 책정의 빌링 이벤트를 트리거할 수 있습니다. 기존 EventBus 구독 패턴을 사용합니다.

**결과 유형:**
- `auto-resolved`: 자동 해결 완료 (value: 1.0)
- `escalated`: 실행했지만 검증 실패 (value: 0.3)
- `false-positive`: 실행 불필요로 판단 (value: 0)
- `failed`: 실행 자체 실패 (value: 0)

**Step 1: 타입 정의**

`src/types/billing.ts` 생성:

```typescript
export type OutcomeType = 'auto-resolved' | 'escalated' | 'false-positive' | 'failed';

export interface BillingEvent {
  id: string;
  instanceId: string;
  timestamp: string;
  eventType: 'operation-outcome';
  outcomeType: OutcomeType;
  operationId: string;
  value: number;               // 금전적 가치 (성과 기반 가격 책정에 사용)
  metadata: Record<string, unknown>;
}
```

**Step 2: 테스트 작성**

`src/lib/__tests__/outcome-tracker.test.ts` 생성:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { classifyOutcome, createBillingEvent } from '@/lib/outcome-tracker';

describe('outcome-tracker', () => {
  describe('classifyOutcome', () => {
    it('should classify successful verified execution as auto-resolved', () => {
      expect(classifyOutcome({ executed: true, passed: true })).toBe('auto-resolved');
    });

    it('should classify failed verification as escalated', () => {
      expect(classifyOutcome({ executed: true, passed: false })).toBe('escalated');
    });

    it('should classify non-executed pass as false-positive', () => {
      expect(classifyOutcome({ executed: false, passed: true })).toBe('false-positive');
    });

    it('should classify non-executed fail as failed', () => {
      expect(classifyOutcome({ executed: false, passed: false })).toBe('failed');
    });
  });

  describe('createBillingEvent', () => {
    it('should create billing event with correct fields', () => {
      const event = createBillingEvent({
        instanceId: 'inst-1',
        operationId: 'op-1',
        outcomeType: 'auto-resolved',
      });

      expect(event.id).toBeDefined();
      expect(event.instanceId).toBe('inst-1');
      expect(event.eventType).toBe('operation-outcome');
      expect(event.outcomeType).toBe('auto-resolved');
      expect(event.value).toBeGreaterThan(0); // auto-resolved는 value 있음
    });

    it('should assign zero value to false-positive outcomes', () => {
      const event = createBillingEvent({
        instanceId: 'inst-1',
        operationId: 'op-2',
        outcomeType: 'false-positive',
      });

      expect(event.value).toBe(0);
    });
  });
});
```

**Step 3: 구현**

`src/lib/outcome-tracker.ts` 생성:

```typescript
import { randomUUID } from 'node:crypto';
import logger from '@/lib/logger';
import { getStore } from '@/lib/redis-store';
import { recordExperience } from '@/lib/experience-store';
import type { BillingEvent, OutcomeType } from '@/types/billing';

// 결과 유형별 기본 가치 단위 (가격 계산에 사용)
const OUTCOME_VALUES: Record<OutcomeType, number> = {
  'auto-resolved': 1.0,
  'escalated': 0.3,
  'false-positive': 0,
  'failed': 0,
};

export function classifyOutcome(result: {
  executed: boolean;
  passed: boolean;
}): OutcomeType {
  if (result.executed && result.passed) return 'auto-resolved';
  if (result.executed && !result.passed) return 'escalated';
  if (!result.executed && result.passed) return 'false-positive';
  return 'failed';
}

export function createBillingEvent(input: {
  instanceId: string;
  operationId: string;
  outcomeType: OutcomeType;
  metadata?: Record<string, unknown>;
}): BillingEvent {
  return {
    id: randomUUID(),
    instanceId: input.instanceId,
    timestamp: new Date().toISOString(),
    eventType: 'operation-outcome',
    outcomeType: input.outcomeType,
    operationId: input.operationId,
    value: OUTCOME_VALUES[input.outcomeType],
    metadata: input.metadata ?? {},
  };
}

export async function trackOutcome(payload: {
  instanceId: string;
  operationId: string;
  executed: boolean;
  passed: boolean;
  resolutionMs: number;
  trigger?: { type: string; metric: string; value: number };
  action?: string;
  protocolId?: string;
  metricsSnapshot?: Record<string, number>;
}): Promise<BillingEvent> {
  const outcomeType = classifyOutcome(payload);
  const event = createBillingEvent({
    instanceId: payload.instanceId,
    operationId: payload.operationId,
    outcomeType,
  });

  // 빌링 이벤트 저장
  const store = getStore();
  await store.addPredictionRecord({
    id: event.id,
    prediction: { outcomeType, value: event.value } as never,
  });

  // 트리거 정보가 있으면 experience로도 기록
  if (payload.trigger && payload.action) {
    await recordExperience({
      instanceId: payload.instanceId,
      protocolId: payload.protocolId ?? 'unknown',
      category: 'anomaly-resolution',
      trigger: payload.trigger,
      action: payload.action,
      outcome: outcomeType === 'auto-resolved' ? 'success'
        : outcomeType === 'escalated' ? 'partial'
        : 'failure',
      resolutionMs: payload.resolutionMs,
      metricsSnapshot: payload.metricsSnapshot ?? {},
    });
  }

  logger.info('[OutcomeTracker] Tracked outcome', {
    instanceId: payload.instanceId,
    outcomeType,
    value: event.value,
  });

  return event;
}
```

**Step 4: 테스트 실행**

실행: `npx vitest run src/lib/__tests__/outcome-tracker.test.ts`
예상: ALL PASS

**Step 5: 커밋**

```bash
git add src/types/billing.ts src/lib/outcome-tracker.ts src/lib/__tests__/outcome-tracker.test.ts
git commit -m "feat(billing): outcome tracker with classification and billing events"
```

---

## Task 12: Metrics History API

**관련 파일:**
- 생성: `src/app/api/metrics/history/route.ts`
- 수정: `src/types/redis.ts` (필요 시 metrics history 메서드 추가)
- 테스트: `src/app/api/metrics/history/route.test.ts`

**배경:**
현재 MetricsStore는 링 버퍼에 60개의 데이터 포인트(1분 간격 1시간)만 보관합니다. 장기 분석을 위해 시간 범위 쿼리를 지원하는 history API가 필요합니다. 기존 `getRecentMetrics()` 패턴을 기반으로 윈도우 집계를 추가합니다. v1에서는 기존 링 버퍼 데이터를 시간 범위 필터링으로 노출합니다.

**지원 duration 파라미터:** `15m`, `30m`, `1h`

**Step 1: 테스트 작성**

`src/app/api/metrics/history/route.test.ts` 생성:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/redis-store', () => ({
  getStore: () => ({
    getRecentMetrics: vi.fn().mockResolvedValue([
      { timestamp: '2026-03-03T10:00:00Z', cpuUsage: 45, gasUsedRatio: 0.5 },
      { timestamp: '2026-03-03T10:01:00Z', cpuUsage: 50, gasUsedRatio: 0.6 },
      { timestamp: '2026-03-03T10:02:00Z', cpuUsage: 55, gasUsedRatio: 0.7 },
    ]),
  }),
}));

const { GET } = await import('./route');

describe('GET /api/metrics/history', () => {
  it('should return metrics within time range', async () => {
    const request = new Request('http://localhost:3002/api/metrics/history?duration=1h');
    const response = await GET(request as never);
    const data = await response.json();

    expect(data.metrics).toBeDefined();
    expect(data.metrics.length).toBeGreaterThan(0);
    expect(data.duration).toBe('1h');
  });

  it('should return 400 for invalid duration', async () => {
    const request = new Request('http://localhost:3002/api/metrics/history?duration=invalid');
    const response = await GET(request as never);
    expect(response.status).toBe(400);
  });
});
```

**Step 2: 구현**

`src/app/api/metrics/history/route.ts` 생성:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/redis-store';

const DURATION_MAP: Record<string, number> = {
  '15m': 15,
  '30m': 30,
  '1h': 60,
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const duration = searchParams.get('duration') || '1h';

  const count = DURATION_MAP[duration];
  if (!count) {
    return NextResponse.json(
      { error: `Invalid duration. Supported: ${Object.keys(DURATION_MAP).join(', ')}` },
      { status: 400 }
    );
  }

  const store = getStore();
  const metrics = await store.getRecentMetrics(count);

  return NextResponse.json({
    metrics,
    count: metrics.length,
    duration,
    maxAvailable: 60,
  });
}
```

**Step 3: 테스트 실행**

실행: `npx vitest run src/app/api/metrics/history/route.test.ts`
예상: ALL PASS

**Step 4: 커밋**

```bash
git add src/app/api/metrics/history/route.ts src/app/api/metrics/history/route.test.ts
git commit -m "feat(api): metrics history endpoint with duration-based filtering"
```

---

## 의존성 그래프

```
Task 1 (백오프) ──┐
Task 2 (kubectl) ──┤── Zero-Downtime 개선 (서로 독립적)
Task 3 (롤백)   ──┘

Task 4 (NLOps 병렬)         ← 독립적

Task 5 (RCA Redis) ──┐
Task 6 (예측 추적)   ──┤── 데이터 영속성 (서로 독립적)

Task 7 (Trace ID)            ← 독립적, 단 Task 8-9를 보강함

Task 8 (Experience Store)    ← Task 7 의존 (trace ID 보강)
Task 9 (Pattern Extractor)   ← Task 8 의존 (experience entry 읽기)
Task 10 (Agent Resume)       ← Task 8 + 9 의존
Task 11 (Outcome Tracker)    ← Task 8 의존
Task 12 (Metrics History)    ← 독립적
```

## 실행 일정

**1-2주차: 엔진 품질 (Task 1-6)**
- Task 1, 2, 3은 병렬 실행 가능 (모두 zero-downtime-scaler.ts 수정이지만 다른 섹션)
- Task 4는 독립적
- Task 5, 6은 독립적

**2-3주차: 관찰가능성 + 기반 구축 (Task 7-9)**
- Task 7 먼저 (Trace ID — Task 8에서 사용)
- Task 8 다음 (Experience Store — Task 9, 10, 11에서 사용)
- Task 9는 Task 8 완료 후

**3-4주차: 완료 (Task 10-12)**
- Task 10, 11, 12는 Task 8/9 완료 후 병렬 실행 가능

---

*원본: Audit P1-P2 작업 계획 + Agent-for-Hire 수익 모델 설계, 2026-03-03*
*한글화: 2026-03-10*
