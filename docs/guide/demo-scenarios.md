# SentinAI 데모 시나리오

SentinAI 기능을 검증하기 위한 사전 조건, 단계별 데모 스크립트 및 예상 결과.

---

## 사전 조건

```bash
npm install
npm run dev          # http://localhost:3002
```

최소 `.env.local` 설정:

```bash
L2_RPC_URL=https://your-l2-rpc-endpoint.com
ANTHROPIC_API_KEY=sk-ant-...        # AI 기능 (사용할 AI 공급자의 API 키)
```

모든 데모는 `SCALING_SIMULATION_MODE=true` (기본값)에서 작동합니다. 실제 K8s 클러스터가 필요하지 않습니다.

---

## 데모 1: 정상 운영 모니터링

**목표**: 기본 메트릭 수집 및 대시보드 렌더링 검증.

```bash
# 안정적인 메트릭 주입 (20개 데이터 포인트, ~1분 간격)
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=stable

# 메트릭 응답 검증
curl -s http://localhost:3002/api/metrics | jq '{
  l2Block: .metrics.blockHeight,
  cpu: .metrics.cpuUsage,
  txPool: .metrics.txPoolCount,
  components: [.components[]?.name],
  cost: .cost.opGethMonthlyCost
}'
```

**예상 결과**:
- CPU: 15~25%
- TxPool: 10~30
- 4개 컴포넌트 표시 (L2 Client, Consensus Node, Batcher, Proposer)
- 현재 vCPU 기준 비용 계산됨

**대시보드**: 브라우저 열기 — 블록 증가, CPU 게이지 안정적, 녹색 상태 표시자 표시.

---

## 데모 2: 이상 탐지 파이프라인

**목표**: 4계층 이상 탐지 파이프라인 트리거 및 관찰.

### 1단계 — 기준선 수립

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=stable
```

### 2단계 — 스파이크 주입

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=spike
```

### 3단계 — 탐지 트리거 (메트릭 폴링)

```bash
curl -s http://localhost:3002/api/metrics | jq '{
  anomalyCount: (.anomalies | length),
  anomalies: [.anomalies[] | {metric, zScore, direction, description}],
  activeEventId: .activeAnomalyEventId
}'
```

**예상 결과**:
- `anomalyCount`: 1개 이상 (cpuUsage, txPoolPending 또는 gasUsedRatio)
- `zScore`: > 2.5
- `activeEventId`: UUID 문자열

### 4단계 — 이상 이벤트 히스토리 확인

```bash
curl -s http://localhost:3002/api/anomalies | jq '{
  total: .total,
  activeCount: .activeCount,
  latestEvent: .events[0] | {id, status, anomalyCount: (.anomalies | length), hasDeepAnalysis: (.deepAnalysis != null)}
}'
```

**예상 결과** (AI 키 설정된 경우):
- `hasDeepAnalysis`: true (계층 2 AI 분석 완료)
- `status`: "active"

### 5단계 — 알림 설정 검증

```bash
curl -s http://localhost:3002/api/anomalies/config | jq '.'
```

**대시보드**: 이상 모니터 패널에 탐지된 이상과 심각도 지표가 표시됨.

---

## 데모 3: 예측 스케일링

**목표**: AI 기반 스케일링 예측 및 추천 시연.

### 1단계 — 상승하는 부하 패턴 주입

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=rising
```

### 2단계 — 예측 확인

```bash
curl -s http://localhost:3002/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  prediction: .prediction | (if . then {
    predictedVcpu,
    confidence: (.confidence * 100 | tostring + "%"),
    trend,
    reasoning,
    action: .recommendedAction
  } else "Not enough data (need 10+ points)" end),
  meta: .predictionMeta | {ready: .isReady, metricsCount, minRequired}
}'
```

**예상 결과**:
- `metricsCount` >= 10 (seed 주입에서)
- `trend`: "increasing"
- `predictedVcpu`: 2 또는 4
- `confidence`: 60~95%

### 3단계 — 스파이크로 반복하여 확장 업 신뢰도 높이기

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=spike
sleep 2
curl -s http://localhost:3002/api/scaler | jq '.prediction | {predictedVcpu, confidence, recommendedAction}'
```

**대시보드**: 스케일링 예측 패널에 예측된 vCPU, 트렌드 방향, 신뢰도 수준 표시.

---

## 데모 4: NLOps 채팅 인터페이스

**목표**: 자연어 운영 제어 시연.

### 안전한 쿼리 (확인 불필요)

```bash
# 상태 조회
curl -sX POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "Show current status"}' | jq '{intent: .intent, response: .response[0:200]}'

# 로그 분석
curl -sX POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "Analyze recent logs"}' | jq '{intent: .intent, response: .response[0:200]}'

# 근본 원인 분석
curl -sX POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "Run root cause analysis"}' | jq '{intent: .intent, response: .response[0:200]}'
```

### 위험한 액션 (확인 필요)

```bash
# 스케일링 요청 — 확인 프롬프트 반환
curl -sX POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "Scale to 4 vCPU"}' | jq '{intent, needsConfirmation, confirmationMessage}'
```

**예상 결과**:
- `intent`: "scale"
- `needsConfirmation`: true
- `confirmationMessage`: 확인할 액션 설명

**대시보드**: 채팅 토글(우측 하단) 클릭, 명령 입력, 위험한 액션 확인/취소.

---

## 데모 5: 비용 최적화

**목표**: 비용 추적 및 AI 기반 최적화 추천 표시.

```bash
# 사용량 데이터 주입
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=stable
sleep 1
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=rising

# 비용 보고서 조회
curl -s http://localhost:3002/api/cost-report | jq '{
  currentCost: .currentMonthlyCost,
  optimizedCost: .optimizedMonthlyCost,
  savingsPercent: .savingsPercent,
  recommendations: [.recommendations[]? | .title]
}'
```

**예상 결과**:
- Fargate Seoul 가격 기준 비용 계산됨
- 고정 4 vCPU 기준선 대비 절감률
- AI 추천사항 (AI 키 설정된 경우)

---

## 데모 6: 근본 원인 분석 (RCA)

**목표**: 의존성 그래프 탐색 및 장애 전파 분석 시연.

### 1단계 — 이상 주입

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=spike
sleep 2
curl -s http://localhost:3002/api/metrics > /dev/null  # 탐지 트리거
```

### 2단계 — RCA 실행

```bash
curl -sX POST http://localhost:3002/api/rca \
  -H "Content-Type: application/json" \
  -d '{}' | jq '{
  rootCause: .result.rootCause,
  affectedComponents: .result.affectedComponents,
  severity: .result.severity,
  remediationAdvice: [.result.remediationAdvice[]? | .action]
}'
```

**예상 결과**:
- `rootCause`: 식별된 컴포넌트 (예: "op-geth resource exhaustion")
- `affectedComponents`: 의존성 체인 (op-geth → op-node → ...)
- `remediationAdvice`: 실행 가능한 단계

---

## 데모 7: 자동 자체 복구 엔진

**목표**: 플레이북 매칭, 안전 게이트 및 자체 복구 실행 검증.

### 1단계 — 자체 복구 상태 확인

```bash
curl -s http://localhost:3002/api/remediation | jq '{
  enabled: .config.enabled,
  circuitBreakers: .circuitBreakers,
  recentExecutions: (.recentExecutions | length)
}'
```

### 2단계 — 활성화 및 트리거 (시뮬레이션 모드)

```bash
# 자동 자체 복구 활성화
curl -sX PATCH http://localhost:3002/api/remediation \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# 플레이북 수동으로 트리거
curl -sX POST http://localhost:3002/api/remediation \
  -H "Content-Type: application/json" \
  -d '{"playbookName": "op-geth-resource-exhaustion"}' | jq '{
  status: .status,
  playbook: .playbook,
  actionsExecuted: .actionsExecuted,
  escalationLevel: .escalationLevel
}'
```

**예상 결과** (시뮬레이션 모드):
- `status`: "completed" 또는 "simulated"
- 액션이 로깅되지만 실제 K8s에는 실행되지 않음

---

## 데모 8: 에이전트 루프 (자율 운영)

**목표**: 서버 측 자율 관찰-탐지-결정-실행 주기 검증.

### 에이전트 루프 실행 확인

```bash
# 스케줄러 상태 확인
curl -s http://localhost:3002/api/health

# 서버 콘솔의 에이전트 루프 로그 감시 (30초마다):
# [AgentLoop] Cycle complete — score: 15.2, target: 1 vCPU
# [AgentLoop] Scaling executed: 1 → 2 vCPU
```

### 자율 스케일링 트리거

```bash
# 1. 자동 스케일링 활성화
curl -sX PATCH http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"autoScalingEnabled": true}'

# 2. 높은 부하 주입
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=spike

# 3. 다음 에이전트 주기 대기 (~30초), 스케일링 상태 확인
sleep 35
curl -s http://localhost:3002/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  simulationMode: .simulationMode,
  lastScaling: .lastScalingTime
}'
```

**예상 결과**: `currentVcpu` 증가 (시뮬레이션 모드에서 상태 업데이트, 실제 K8s 패치 없음).

---

## 데모 9: 전체 파이프라인 (엔드-투-엔드)

**목표**: 정상 → 이상 → 탐지 → 스케일링 → 자체 복구 → 복구의 완전한 파이프라인 실행.

```bash
#!/bin/bash
BASE=http://localhost:3002

echo "=== Phase 1: 기준선 ==="
curl -sX POST $BASE/api/metrics/seed?scenario=stable
curl -s $BASE/api/metrics | jq '{cpu: .metrics.cpuUsage, anomalies: (.anomalies | length)}'
sleep 2

echo "=== Phase 2: 부하 증가 ==="
curl -sX POST $BASE/api/metrics/seed?scenario=rising
curl -s $BASE/api/scaler | jq '{prediction: .prediction.trend, confidence: .prediction.confidence}'
sleep 2

echo "=== Phase 3: 스파이크 (이상 트리거) ==="
curl -sX POST $BASE/api/metrics/seed?scenario=spike
sleep 1
curl -s $BASE/api/metrics | jq '{cpu: .metrics.cpuUsage, anomalies: [.anomalies[] | .metric]}'

echo "=== Phase 4: 스케일링 결정 ==="
curl -s $BASE/api/scaler | jq '{current: .currentVcpu, predicted: .prediction.predictedVcpu}'

echo "=== Phase 5: 근본 원인 분석 ==="
curl -sX POST $BASE/api/rca | jq '{cause: .result.rootCause, severity: .result.severity}'

echo "=== Phase 6: 자체 복구 ==="
curl -s $BASE/api/remediation | jq '{executions: (.recentExecutions | length)}'

echo "=== Phase 7: 복구 ==="
curl -sX POST $BASE/api/metrics/seed?scenario=falling
sleep 2
curl -s $BASE/api/metrics | jq '{cpu: .metrics.cpuUsage, anomalies: (.anomalies | length)}'

echo "=== Phase 8: 안정 ==="
curl -sX POST $BASE/api/metrics/seed?scenario=stable
curl -s $BASE/api/metrics | jq '{cpu: .metrics.cpuUsage, anomalies: (.anomalies | length)}'
echo "=== 완료 ==="
```

**예상 흐름**:
1. 기준선: CPU ~20%, 이상 0개
2. 상승: 예측 트렌드 "increasing"
3. 스파이크: 이상 탐지 (cpuUsage, txPoolPending)
4. 스케일링: 예측된 vCPU 증가
5. RCA: 근본 원인 식별됨
6. 자체 복구: 플레이북 매칭됨 (활성화된 경우)
7. 하강: 이상 해결 중
8. 안정: 정상 상태로 복귀, 이상 0개

---

## 데모 10: 스트레스 모드 (대시보드 UI)

**목표**: 실제 인프라 없이 고부하 상태의 시각적 시연.

1. `http://localhost:3002` 열기
2. **STRESS MODE** 토글 클릭 (상단)
3. 관찰:
   - CPU 96.5%로 점프
   - vCPU 8 표시 (최대 스케일)
   - 컴포넌트가 "Scaling Up" 상태 표시
   - 비용이 8 vCPU Fargate 가격 반영
4. 토글을 다시 클릭하여 정상으로 복귀

---

## 자동화된 테스트 명령어

| 명령어 | 범위 | 실행 시간 |
|--------|------|----------|
| `npm run test:run` | 559개 단위 테스트 | ~1초 |
| `npm run test:coverage` | 단위 테스트 + 커버리지 보고서 | ~3초 |
| `npm run verify` | 전체 6단계 E2E | 5~10분 |
| `npm run lint` | ESLint 확인 | ~5초 |

---

## Seed 시나리오 참조

| 시나리오 | CPU 범위 | TxPool | 포인트 | 사용 사례 |
|---------|---------|--------|--------|----------|
| `stable` | 15~25% | 10~30 | 20 | 기준선, 정상 운영 |
| `rising` | 15→50% | 10→80 | 20 | 예측 스케일링 데모 |
| `spike` | ~95% | 5000+ | 20 | 이상 탐지 데모 |
| `falling` | 80→20% | 감소 중 | 20 | 복구 데모 |
| `live` | 실시간 데이터 | 실시간 데이터 | 변함 | 프로덕션 유사 (누적 데이터 필요) |

```bash
# 모든 시나리오 주입
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=<name>
```

---

## 프로덕션 클러스터 테스트

seed API는 프로덕션(`NODE_ENV=production`)에서 사용할 수 없습니다. 실시간 부하 주입을 사용한 실제 K8s 스케일링 검증은 다음을 참고하세요:

**[프로덕션 부하 테스트 가이드](./production-load-testing-guide.md)**
