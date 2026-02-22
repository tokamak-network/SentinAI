# SentinAI Q1 Operations Runbook (Proposal 22-24)

## Scope

- Guardian Agent v2 cycle operation (`observe -> detect -> analyze -> plan -> act -> verify`)
- Agent memory / decision trace inspection and replay
- Adaptive model routing policy operation and rollback

## 1. Guardian Agent v2

### 1.1 Health Checks

1. Agent loop 상태 확인
```bash
curl -s http://localhost:3002/api/agent-loop | jq '.scheduler, .lastCycle.phase, .lastCycle.decisionId'
```
2. phase trace 확인
```bash
curl -s http://localhost:3002/api/agent-loop | jq '.lastCycle.phaseTrace'
```
3. verification 확인
```bash
curl -s http://localhost:3002/api/agent-loop | jq '.lastCycle.verification'
```

### 1.2 Degraded Incident Handling

1. degraded 여부 확인
```bash
curl -s http://localhost:3002/api/agent-loop | jq '.lastCycle.degraded'
```
2. `observe-fallback:last-safe-metrics` 발생 시
- L2 RPC 상태를 우선 점검한다.
- 최근 수집 메트릭이 오래된 경우 seed/live 데이터 소스를 확인한다.
3. `act-failed:*` 발생 시
- 오케스트레이터(k8s/docker) 권한/연결 상태를 확인한다.
- verify 결과와 실제 vCPU 상태를 대조한다.

## 2. Agent Memory / Decision Trace

### 2.1 최근 메모리 조회

```bash
curl -s "http://localhost:3002/api/agent-memory?limit=20" | jq '.total, .entries[0]'
```

### 2.2 Decision Trace 조회

1. 최근 trace 목록
```bash
curl -s "http://localhost:3002/api/agent-decisions?limit=20" | jq '.total, .traces[0].decisionId'
```
2. 단건 조회
```bash
curl -s "http://localhost:3002/api/agent-decisions?decisionId=<decisionId>" | jq '.trace'
```

### 2.3 Incident Replay 기본 절차

1. 실패 또는 고위험 cycle의 `decisionId`를 확보한다.
2. trace의 `reasoningSummary`, `evidence`, `verification`을 확인한다.
3. 동일 시간대 activity log와 phase trace를 함께 비교한다.
4. 재발 시 memory query 조건(`component`, `severity`, `fromTs`)으로 유사 사례를 조회한다.

## 3. Adaptive Routing Policy

### 3.1 상태 확인

```bash
curl -s http://localhost:3002/api/ai-routing/status | jq '.policy, .budget, .circuitStates, .counters'
```

점검 항목:
- `budget.exceeded`: 일일 예산 초과 여부
- `circuitStates[].isOpen`: provider circuit open 여부
- `counters.fallbackRecovered`: fallback 복구 성공 건수

### 3.2 정책 변경 (관리자)

`SENTINAI_API_KEY`가 설정된 경우에만 정책 변경이 허용된다.

```bash
curl -s -X POST http://localhost:3002/api/ai-routing/policy \
  -H "content-type: application/json" \
  -H "x-api-key: ${SENTINAI_API_KEY}" \
  -d '{"name":"balanced","enabled":true,"abPercent":25,"budgetUsdDaily":80}' | jq
```

### 3.3 롤백 체크리스트

1. 즉시 정적 동작으로 회귀
- `AI_ROUTING_ENABLED=false`
2. 정책 초기화
- `AI_ROUTING_POLICY=balanced`
- `AI_ROUTING_AB_PERCENT=0`
3. 장애 분석을 위해 상태/trace는 유지
- `/api/ai-routing/status`
- `/api/agent-decisions`

## 4. Environment Defaults

- `AGENT_MEMORY_ENABLED=true`
- `AGENT_MEMORY_RETENTION_DAYS=30`
- `AI_ROUTING_ENABLED=true`
- `AI_ROUTING_POLICY=balanced`
- `AI_ROUTING_AB_PERCENT=10`
- `AI_ROUTING_BUDGET_USD_DAILY=50`

