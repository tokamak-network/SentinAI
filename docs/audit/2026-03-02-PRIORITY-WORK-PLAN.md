# SentinAI 우선순위 작업 계획 (Priority Work Plan)
**기준**: Comprehensive Audit 결과 (2026-03-02)
**목표**: B+ (65/100) → A- (80/100) 달성
**예상 기간**: 3-4주 (병렬 개발)

---

## 📋 작업 우선순위 요약

| 우선순위 | 작업 | 영향도 | 소요시간 | 담당자 | 기한 |
|---------|------|--------|---------|--------|------|
| **P0** | 환경 매개변수화 (15개 변수) | 운영성 +20 | 2-3일 | Dev 1 | 2026-03-09 |
| **P0** | Webhook 신뢰성 (timeout + retry) | 신뢰성 +30 | 1-2일 | Dev 1 | 2026-03-07 |
| **P0** | Scaling decision 로깅 강화 | 운영성 +15 | 1일 | Dev 2 | 2026-03-06 |
| **P1** | Zero-Downtime Phase 2 최적화 | 성능 +20 | 3-4일 | Dev 2 | 2026-03-13 |
| **P1** | NLOps tool 병렬화 | 성능 +15 | 2-3일 | Dev 1 | 2026-03-13 |
| **P1** | RCA/Prediction history Redis | 운영성 +10 | 2-3일 | Dev 2 | 2026-03-13 |
| **P2** | Trace ID 기반 추적 | 운영성 +10 | 3-4일 | Dev 1 | 2026-03-20 |
| **P2** | Metrics history API | 운영성 +8 | 2-3일 | Dev 2 | 2026-03-20 |
| **P3** | Production guides 작성 | 운영성 +5 | 3-4일 | Doc | 2026-03-27 |

---

## 🔴 P0 Critical (Week 1-2)

### 작업 1: 환경 매개변수화 (모든 Stage)
**우선순위**: P0 | **영향도**: 운영성 +20점 | **소요**: 2-3일

#### Stage 1: Observation Layer
**파일**:
- `src/app/api/metrics/route.ts`
- `src/lib/l1-rpc-cache.ts`
- `src/core/collectors/evm-execution.ts`
- `src/core/collectors/opstack-l2.ts`

**변경 사항**:
```typescript
// 현재 (하드코딩):
const RPC_TIMEOUT_MS = 15000;
const STATUS_PROBE_TIMEOUT_MS = 5000;
const L1_BLOCK_CACHE_TTL_MS = 6000;
const EOA_BALANCE_CACHE_TTL_MS = 300000;

// 변경 후 (환경변수):
const RPC_TIMEOUT_MS = parseInt(process.env.RPC_TIMEOUT_MS || '15000');
const STATUS_PROBE_TIMEOUT_MS = parseInt(process.env.STATUS_PROBE_TIMEOUT_MS || '5000');
const L1_BLOCK_CACHE_TTL_MS = parseInt(process.env.L1_CACHE_TTL_MS || '6000');
const EOA_BALANCE_CACHE_TTL_MS = parseInt(process.env.EOA_CACHE_TTL_MS || '300000');
```

**환경변수 추가** (.env.local.sample):
```
# Stage 1: Observation Layer
RPC_TIMEOUT_MS=15000                    # L2 RPC 호출 타임아웃 (ms)
STATUS_PROBE_TIMEOUT_MS=5000             # ZK batcher status 조회 타임아웃 (ms)
L1_CACHE_TTL_MS=6000                     # L1 블록 캐시 지속 시간 (ms)
EOA_CACHE_TTL_MS=300000                  # EOA 밸런스 캐시 지속 시간 (ms)
EVM_RPC_TIMEOUT_MS=10000                 # EVM collector RPC 타임아웃 (ms)
OPSTACK_RPC_TIMEOUT_MS=15000             # OP Stack collector RPC 타임아웃 (ms)
CONN_VALIDATE_TIMEOUT_MS=8000            # 연결 검증 타임아웃 (ms)
```

**테스트**:
```bash
npm run test src/lib/__tests__/metrics-store.test.ts
npm run dev # L2_RPC_URL 설정 후 http://localhost:3002/api/metrics 확인
```

---

#### Stage 2: Detection Layer
**파일**: `src/core/anomaly-detector.ts`

**변경 사항**:
```typescript
// 현재:
const Z_SCORE_THRESHOLD = 3.0;
const BLOCK_PLATEAU_SECONDS = 120;
const TXPOOL_MONOTONIC_SECONDS = 300;

// 변경 후:
const Z_SCORE_THRESHOLD = parseFloat(process.env.ANOMALY_Z_SCORE_THRESHOLD || '3.0');
const BLOCK_PLATEAU_SECONDS = parseInt(process.env.ANOMALY_BLOCK_PLATEAU_SECONDS || '120');
const TXPOOL_MONOTONIC_SECONDS = parseInt(process.env.ANOMALY_TXPOOL_MONOTONIC_SECONDS || '300');
```

**환경변수 추가**:
```
# Stage 2: Detection Layer
ANOMALY_Z_SCORE_THRESHOLD=3.0            # Z-Score 이상 감지 임계값
ANOMALY_BLOCK_PLATEAU_SECONDS=120        # Block plateau 지속 시간 (초)
ANOMALY_TXPOOL_MONOTONIC_SECONDS=300     # TxPool 지속 증가 시간 (초)
ANOMALY_MIN_STD_DEV_CPU=0.02             # CPU 최소 표준편차
ANOMALY_MIN_STD_DEV_GAS=0.05             # Gas 최소 표준편차
ANOMALY_MIN_STD_DEV_TXPOOL=10            # TxPool 최소 표준편차
ANOMALY_AI_RATE_LIMIT_MS=60000           # AI 호출 레이트 제한 (ms)
ANOMALY_AI_CACHE_TTL_MS=300000           # AI 분석 캐시 지속 시간 (ms)
```

---

#### Stage 3: Decision Layer
**파일**:
- `src/lib/scaling-decision.ts`
- `src/core/rca-engine.ts`
- `src/lib/predictive-scaler.ts`

**변경 사항**:
```typescript
// 현재:
const WEIGHTS = {
  cpu: 0.3,
  gas: 0.3,
  txPool: 0.2,
  ai: 0.2
};

// 변경 후:
const WEIGHTS = {
  cpu: parseFloat(process.env.SCALING_WEIGHT_CPU || '0.3'),
  gas: parseFloat(process.env.SCALING_WEIGHT_GAS || '0.3'),
  txPool: parseFloat(process.env.SCALING_WEIGHT_TXPOOL || '0.2'),
  ai: parseFloat(process.env.SCALING_WEIGHT_AI || '0.2')
};
```

**환경변수 추가**:
```
# Stage 3: Decision Layer - Scaling Weights
SCALING_WEIGHT_CPU=0.3                   # CPU 가중치 (0-1)
SCALING_WEIGHT_GAS=0.3                   # Gas 가중치 (0-1)
SCALING_WEIGHT_TXPOOL=0.2                # TxPool 가중치 (0-1)
SCALING_WEIGHT_AI=0.2                    # AI 가중치 (0-1)

# Stage 3: Scaling Thresholds
SCALING_IDLE_THRESHOLD=30                # Idle tier 임계값 (점수)
SCALING_NORMAL_THRESHOLD=70              # Normal tier 임계값
SCALING_CRITICAL_THRESHOLD=77            # Critical tier 임계값
SCALING_COOLDOWN_SECONDS=300             # 스케일링 cooldown (초)

# Stage 3: RCA Engine
RCA_TIMEOUT_MS=15000                     # RCA 분석 타임아웃 (ms, 기본 30s)
RCA_MAX_RETRIES=1                        # RCA 최대 재시도 횟수 (기본 2)
RCA_MAX_HISTORY_SIZE=20                  # RCA 히스토리 최대 크기
```

---

#### Stage 4: Action Layer
**파일**: `src/lib/zero-downtime-scaler.ts`, `src/lib/k8s-scaler.ts`

**환경변수 추가**:
```
# Stage 4: Zero-Downtime Scaling Timeouts
ZERO_DOWNTIME_READY_TIMEOUT_MS=300000    # Ready 폴링 타임아웃 (ms, 5분)
ZERO_DOWNTIME_POLL_INTERVAL_MS=10000     # Ready 폴링 간격 (ms, 10초)
ZERO_DOWNTIME_POD_CLEANUP_SLEEP_MS=30000 # Pod 정리 대기 시간 (ms, 30초)
KUBECTL_TOP_TIMEOUT_MS=5000              # kubectl top 타임아웃 (ms)
RPC_CHECK_TIMEOUT_MS=15000               # RPC 체크 타임아웃 (ms)

# Stage 4: Remediation Config
REMEDIATION_MAX_EXECUTIONS_HOUR=3        # 시간당 최대 remediation 실행 횟수
REMEDIATION_MAX_EXECUTIONS_DAY=10        # 일일 최대 remediation 실행 횟수
REMEDIATION_CIRCUIT_THRESHOLD=3          # Circuit breaker 임계값 (연속 실패)
```

---

#### Stage 5: Communication Layer
**파일**: `src/lib/notification-adapters/slack-adapter.ts`, `src/lib/daily-report-generator.ts`

**환경변수 추가**:
```
# Stage 5: Alert & Webhook
WEBHOOK_TIMEOUT_MS=5000                  # Webhook 타임아웃 (ms)
WEBHOOK_RETRY_ATTEMPTS=3                 # Webhook 재시도 횟수
WEBHOOK_RETRY_BACKOFF_MS=100             # Webhook 재시도 대기 시간 (ms)

# Stage 5: Daily Report
DAILY_REPORT_SCHEDULE=0 6 * * *           # Cron 스케줄 (매일 6:00 AM)
DAILY_REPORT_MAX_TOKENS=4096             # 리포트 최대 토큰 수
DAILY_REPORT_TEMPERATURE=0.3             # AI 리포트 생성 temperature

# Stage 5: NLOps
NLOPS_ENABLED=true                       # NLOps 기능 활성화
NLOPS_TOOL_EXECUTION_TIMEOUT_MS=30000    # Tool 실행 타임아웃 (ms)
```

**검증 기준**:
- [ ] 모든 환경변수가 .env.local.sample에 기록됨
- [ ] 각 하드코딩 값을 process.env로 치환
- [ ] 기본값 합리성 확인
- [ ] 단위 테스트 통과 (51개 전체)
- [ ] E2E: 환경변수 변경 후 동작 확인

---

### 작업 2: Webhook 신뢰성 개선
**우선순위**: P0 | **영향도**: 신뢰성 +30점 | **소요**: 1-2일

**파일**: `src/lib/notification-adapters/slack-adapter.ts`, `src/core/alert-dispatcher.ts`

#### 2.1 Webhook timeout 추가
**변경 전** (line 222):
```typescript
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
```

**변경 후**:
```typescript
const timeoutMs = parseInt(process.env.WEBHOOK_TIMEOUT_MS || '5000');
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal
  });
  clearTimeout(timeout);
  return response;
} catch (err) {
  clearTimeout(timeout);
  if (err.name === 'AbortError') {
    throw new Error(`Webhook timeout after ${timeoutMs}ms`);
  }
  throw err;
}
```

#### 2.2 Webhook 재시도 로직
**파일**: `src/core/alert-dispatcher.ts` (line 218-240 수정)

**구현**:
```typescript
async function dispatchAlertWithRetry(alert: AlertConfig, payload: any) {
  const maxRetries = parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS || '3');
  const backoffMs = parseInt(process.env.WEBHOOK_RETRY_BACKOFF_MS || '100');

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await sendWebhook(alert.webhookUrl, payload);
      if (response.ok) {
        return { success: true, statusCode: response.status };
      }
    } catch (err) {
      if (attempt < maxRetries - 1) {
        const delay = backoffMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      // Last attempt failed
      return {
        success: false,
        error: `Webhook failed after ${maxRetries} attempts: ${err.message}`
      };
    }
  }
}
```

#### 2.3 Dead Letter Queue
**구현 위치**: `src/core/alert-dispatcher.ts`

```typescript
// 실패한 alert 저장
async function saveFailedAlertToDLQ(alert: Alert, error: Error) {
  await store.addFailedAlert({
    alert,
    error: error.message,
    timestamp: Date.now(),
    retryCount: 0,
    nextRetryAt: Date.now() + 60000 // 1분 후 재시도
  });
}

// Scheduled job (매 30분)
setInterval(async () => {
  const failedAlerts = await store.getFailedAlerts({ limit: 100 });
  for (const { alert, nextRetryAt } of failedAlerts) {
    if (Date.now() >= nextRetryAt) {
      const result = await dispatchAlertWithRetry(alert.config, alert.payload);
      if (result.success) {
        await store.removeFailedAlert(alert.id);
      } else {
        await store.updateFailedAlert(alert.id, {
          retryCount: alert.retryCount + 1
        });
      }
    }
  }
}, 30 * 60 * 1000);
```

**검증 기준**:
- [ ] Webhook timeout 환경변수 반영됨
- [ ] 3회 재시도 + exponential backoff 작동
- [ ] DLQ에 실패한 alert 저장됨
- [ ] DLQ 재시도 job이 30분마다 실행됨
- [ ] E2E: webhook 다운 시 3회 재시도 확인

---

### 작업 3: Scaling Decision 로깅 강화
**우선순위**: P0 | **영향도**: 운영성 +15점 | **소요**: 1일

**파일**: `src/lib/scaling-decision.ts`

#### 변경 전 (line 91-125):
```typescript
export async function calculateScalingDecision(
  metrics: ScalingMetrics
): Promise<ScalingDecision> {
  // ... 계산 로직
  return {
    targetVcpu,
    currentScore: score,
    reason: // minimal reason
  };
}
```

#### 변경 후:
```typescript
export async function calculateScalingDecision(
  metrics: ScalingMetrics
): Promise<ScalingDecision> {
  const cpuScore = metrics.cpuUsage / 100 * 100;
  const gasScore = metrics.gasUsedRatio / 100 * 100;
  const txPoolScore = Math.min((metrics.txPoolCount / 1000) * 100, 100);
  const aiScore = (await getAISeverityScore(metrics)) * 100;

  const weights = {
    cpu: parseFloat(process.env.SCALING_WEIGHT_CPU || '0.3'),
    gas: parseFloat(process.env.SCALING_WEIGHT_GAS || '0.3'),
    txPool: parseFloat(process.env.SCALING_WEIGHT_TXPOOL || '0.2'),
    ai: parseFloat(process.env.SCALING_WEIGHT_AI || '0.2')
  };

  const score =
    cpuScore * weights.cpu +
    gasScore * weights.gas +
    txPoolScore * weights.txPool +
    aiScore * weights.ai;

  // 로깅 추가
  logger.info('[ScalingDecision]', {
    scores: {
      cpu: cpuScore.toFixed(1),
      gas: gasScore.toFixed(1),
      txPool: txPoolScore.toFixed(1),
      ai: aiScore.toFixed(1)
    },
    weights,
    totalScore: score.toFixed(1),
    targetTier: determineTier(score),
    metrics: {
      cpuUsage: metrics.cpuUsage,
      gasUsedRatio: metrics.gasUsedRatio,
      txPoolCount: metrics.txPoolCount
    }
  });

  return {
    targetVcpu,
    currentScore: score,
    scores: { cpuScore, gasScore, txPoolScore, aiScore },
    reason: `Score: ${score.toFixed(1)} → ${determineTier(score)} (CPU ${weights.cpu}×${cpuScore.toFixed(1)} + Gas ${weights.gas}×${gasScore.toFixed(1)} + TxPool ${weights.txPool}×${txPoolScore.toFixed(1)} + AI ${weights.ai}×${aiScore.toFixed(1)})`
  };
}
```

#### 타입 확장 (src/types/scaling.ts):
```typescript
export interface ScalingDecision {
  targetVcpu: TargetVcpu;
  currentScore: number;
  scores?: {  // 추가
    cpuScore: number;
    gasScore: number;
    txPoolScore: number;
    aiScore: number;
  };
  reason: string;
}
```

**검증 기준**:
- [ ] 로그에 scores breakdown 기록됨
- [ ] ScalingHistoryEntry에도 scores 저장됨
- [ ] Dashboard에서 "Score breakdown" 차트 표시 (미래 개선)
- [ ] Unit test: 가중치 변경 시 점수 변함 확인

---

---

## 🟠 P1 High Priority (Week 2-3)

### 작업 4: Zero-Downtime Phase 2 최적화
**우선순위**: P1 | **영향도**: 성능 +20점, 응답시간 50% 단축 | **소요**: 3-4일

**파일**: `src/lib/zero-downtime-scaler.ts`

#### 4.1 폴링 간격 지수백오프
**변경 전** (line 271):
```typescript
const POLL_INTERVAL_MS = 10000; // 고정 10초
for (let i = 0; i < MAX_RETRIES; i++) {
  await _testHooks.sleep(POLL_INTERVAL_MS);
  // check
}
```

**변경 후**:
```typescript
const baseIntervalMs = parseInt(process.env.ZERO_DOWNTIME_POLL_INTERVAL_MS || '1000');
const intervals = [1000, 2000, 5000, 10000];

for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  const intervalIndex = Math.min(attempt, intervals.length - 1);
  const intervalMs = intervals[intervalIndex];

  logger.debug(`[ZeroDowntime] Phase 2 attempt #${attempt + 1}/${MAX_RETRIES}, waiting ${intervalMs}ms`);
  await _testHooks.sleep(intervalMs);

  // check ready
}
```

**예상 효과**: 300초 timeout → 230초 (기대 25회 폴링)

#### 4.2 Ready check kubectl 통합
**변경 전** (line 276-326, 3개 호출):
```typescript
// 호출 1: ready status
const podReady = await kubectl(`get pod ${podName} -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'`);

// 호출 2: pod IP
const podIP = await kubectl(`get pod ${podName} -o jsonpath='{.status.podIP}'`);

// 호출 3: RPC health check
const rpcCheck = await kubectl(`exec ${podName} -- wget -q -O - http://localhost:8545`);
```

**변경 후** (1개 통합 호출 + RPC 병렬):
```typescript
// 단일 kubectl 호출
const podStatus = await kubectl(`get pod ${podName} -o jsonpath='{status.conditions[?(@.type=="Ready")].status},{.status.podIP}'`);
const [isReady, podIP] = podStatus.split(',');

// RPC 체크는 병렬로 (ready status와 독립적)
const rpcCheckPromise = kubectl(`exec ${podName} -- wget -q -O - http://localhost:8545`)
  .then(() => true)
  .catch(() => false)
  .timeout(RPC_CHECK_TIMEOUT_MS);

if (isReady === 'True' && podIP) {
  await Promise.all([rpcCheckPromise]); // 병렬 대기
  return true;
}
```

#### 4.3 Partial rollback 자동화
**변경 전** (line 362-371):
```typescript
// Traffic switch 실패 시 아무 조치 없음
try {
  await switchTraffic(...);
} catch (err) {
  logger.error('Traffic switch failed:', err);
  // throw하면 전체 rollback
}
```

**변경 후**:
```typescript
try {
  await switchTraffic(...);
} catch (err) {
  logger.error('Traffic switch failed, attempting partial recovery:', err);

  // Old pod을 즉시 active로 복구
  try {
    await kubectl(`label pod ${oldPodName} -o json slot=active --overwrite`);
    logger.info('Partial recovery successful: old pod labeled as active');
    return { success: false, recovered: true };
  } catch (rollbackErr) {
    logger.error('Partial recovery failed:', rollbackErr);
    throw rollbackErr;
  }
}
```

**검증 기준**:
- [ ] 폴링 간격이 [1s, 2s, 5s, 10s]로 지수백오프됨
- [ ] 전체 timeout 230초 이내
- [ ] kubectl 호출 1회로 감소 (3회 → 1회)
- [ ] 평균 Ready 폴링 시간 2.5분 → 1.5분 (단축)
- [ ] Partial failure 시 자동 복구 작동

---

### 작업 5: NLOps Tool 병렬화
**우선순위**: P1 | **영향도**: 성능 +15점, 응답시간 48% 단축 | **소요**: 2-3일

**파일**: `src/core/nlops-engine.ts`

#### 변경 전 (line 547-552):
```typescript
for (const toolCall of toolCalls) {
  try {
    const result = await executeTool(toolCall);
    results.push(result);
  } catch (err) {
    results.push({ error: err.message });
  }
}
```

#### 변경 후:
```typescript
// Tool execution 병렬화
const toolPromises = toolCalls.map(toolCall =>
  executeTool(toolCall)
    .catch(err => ({ error: err.message, tool: toolCall.name }))
);

const results = await Promise.allSettled(toolPromises);
const toolResults = results.map((result, idx) => ({
  ...result.value,
  toolName: toolCalls[idx].name
}));

// 부분 실패 로깅
const failedTools = toolResults.filter(r => r.error);
if (failedTools.length > 0) {
  logger.warn('[NLOps] Some tools failed', {
    failed: failedTools.map(r => r.toolName)
  });
}
```

**예상 효과**:
- Tool 실행 시간: 5초 (순차) → 1-2초 (병렬)
- 전체 응답: 8.6초 → 4.5초 (48% 단축)

**검증 기준**:
- [ ] Tool 실행이 Promise.allSettled로 병렬 처리됨
- [ ] 부분 실패 시 error 필드 포함
- [ ] 응답 시간 50% 이상 단축 확인
- [ ] E2E: NLOps 응답 4-5초 이내

---

### 작업 6: RCA/Prediction History Redis 이전
**우선순위**: P1 | **영향도**: 운영성 +10점 | **소요**: 2-3일

**파일**: `src/core/rca-engine.ts`, `src/lib/predictive-scaler.ts`

#### 6.1 RCA History Redis 저장
**변경 전** (메모리, line 531):
```typescript
const rca_history: RCAEvent[] = []; // 최대 20개만 보유
```

**변경 후** (Redis):
```typescript
async function addRCAHistory(event: RCAEvent) {
  const key = `rca:history:${Date.now()}`;
  const ttl = 7 * 24 * 60 * 60; // 7일

  await store.setWithTTL(key, JSON.stringify(event), ttl);

  // 최신 20개만 조회하도록 sorted set 유지
  await store.zadd('rca:history:indices', Date.now(), key);
  const outdatedKeys = await store.zrange('rca:history:indices', 0, -21);
  for (const oldKey of outdatedKeys) {
    await store.del(oldKey);
  }
}

async function getRCAHistory(limit: number = 20) {
  const keys = await store.zrevrange('rca:history:indices', 0, limit - 1);
  const events = await Promise.all(
    keys.map(key => store.get(key).then(JSON.parse))
  );
  return events;
}
```

#### 6.2 Prediction Accuracy 추적
**구현**:
```typescript
async function recordPredictionAccuracy(
  prediction: PredictionResult,
  actualVcpu: TargetVcpu
) {
  const accuracy = prediction.targetVcpu === actualVcpu ? 1 : 0;

  const record = {
    timestamp: Date.now(),
    predicted: prediction.targetVcpu,
    actual: actualVcpu,
    confidence: prediction.confidence,
    accurate: accuracy,
    metrics: prediction.metrics
  };

  await store.setWithTTL(
    `prediction:accuracy:${Date.now()}`,
    JSON.stringify(record),
    30 * 24 * 60 * 60 // 30일
  );

  // 최근 100개 정확도 평균
  const recentRecords = await store.zrevrange('prediction:accuracy:indices', 0, 99);
  const accuracies = await Promise.all(recentRecords.map(k => store.get(k).then(JSON.parse)));
  const avgAccuracy = accuracies.reduce((sum, r) => sum + r.accurate, 0) / accuracies.length;

  logger.info('[Prediction]', {
    accuracy: (avgAccuracy * 100).toFixed(1) + '%',
    recent100: accuracies.length
  });
}
```

**검증 기준**:
- [ ] RCA history가 Redis에 저장됨 (7일 TTL)
- [ ] 프로세스 재시작 후에도 히스토리 복구됨
- [ ] Prediction accuracy 추적 가능
- [ ] GET /api/rca/history?limit=50 API 작동
- [ ] GET /api/prediction/accuracy API 구현 (미래)

---

---

## 🟡 P2 Medium Priority (Week 3-4)

### 작업 7: Trace ID 기반 추적
**우선순위**: P2 | **영향도**: 운영성 +10점 | **소요**: 3-4일

**구현**:
1. Request ID 생성 (모든 API 요청)
2. 모든 로그에 포함
3. 응답 헤더에 포함
4. 이상 탐지 → 분석 → 스케일링 전체 흐름 추적

---

### 작업 8: Metrics History API
**우선순위**: P2 | **영향도**: 운영성 +8점 | **소요**: 2-3일

**구현**:
```
GET /api/metrics/history?duration=1h&window=5m
GET /api/metrics/history?duration=24h&window=1h
```

---

---

## 📅 주간 일정

### Week 1 (Mar 2-8)
```
Mon: Task 1.1 - Stage 1 환경변수화 (RPC/K8s timeout)
Tue-Wed: Task 1.2-1.4 - 나머지 Stage 환경변수화
Thu: Task 2 - Webhook timeout + retry
Fri: Task 3 - Scaling decision 로깅 + 통합 테스트

기대 효과:
- 모든 운영자 튜닝 가능
- 메시지 손실 거의 0%
- 의사결정 투명성 확보
```

### Week 2 (Mar 9-15)
```
Mon-Tue: Task 4 - Zero-Downtime Phase 2 최적화
Wed-Thu: Task 5 - NLOps tool 병렬화
Fri: Task 6 - RCA/Prediction history Redis 이전 + 테스트

기대 효과:
- 스케일링 시간 6분 → 3분 (50% 단축)
- NLOps 응답 8.6초 → 4.5초 (48% 단축)
- 데이터 손실 방지
```

### Week 3 (Mar 16-22)
```
Mon-Tue: Task 7 - Trace ID 기반 추적
Wed-Thu: Task 8 - Metrics history API
Fri: Load testing + E2E 검증

기대 효과:
- 요청 경로 추적 가능
- 히스토리 분석 기능
- 전체 시스템 안정성 확인
```

### Week 4 (Mar 23-29)
```
Mon-Wed: Production readiness checklist 검증
Thu-Fri: Load/stress/chaos testing

기대 효과:
- A- 수준 달성 (80/100)
- Production 배포 확신
```

---

## 📊 예상 성과

| 지표 | 현재 | 개선 후 | 증감 |
|------|------|--------|------|
| **운영성 점수** | 65 | **80+** | +23% |
| **성능 점수** | 65 | **78+** | +20% |
| **Zero-Downtime** | 6분+ | **3분** | -50% |
| **NLOps 응답** | 8.6초 | **4.5초** | -48% |
| **메시지 손실** | ~0.5% | **<0.01%** | -99% |
| **환경 적응성** | 재배포 필수 | **환경변수 조정** | 자유 |

---

## ✅ 완료 기준

### 배포 전 Go/No-Go 결정
- [ ] 모든 P0 작업 완료
- [ ] Unit test 통과율 ≥ 95%
- [ ] E2E 테스트 주요 흐름 통과
- [ ] 부하 테스트: 1000 RPS에서 P99 < 5초
- [ ] 실제 환경에서 최소 2주 운영 테스트

### 배포 후 목표
- [ ] Production readiness checklist 100% 체크
- [ ] 운영성 + 성능 점수 각 80점 이상
- [ ] Alert delivery rate 99.5% 이상
- [ ] 평균 응답 시간 SLA 만족
- [ ] 자동화 작업 안정적 실행

---

**작성**: Claude Code Audit Agent
**기준 문서**: 2026-03-02 Comprehensive Audit
**최종 목표**: Self-Hosted Production 배포 준비 완료 (2026-03-23)
