# Multi-Stack Autonomous Ops Validation Guide

기준일: 2026-02-24

이 문서는 SentinAI의 멀티스택 자율 운영 구조(OP Stack / Arbitrum Orbit / ZK Stack)를
대시보드와 API 레벨에서 검증하는 표준 절차를 정의한다.

## 1. 목적

- 목적: SentinAI가 단순 모니터링이 아니라 체인별 intent/action을 안전하게 실행하는지 확인
- 검증 대상:
  - Dashboard: `Autonomy Cockpit`
  - API: `/api/autonomous/*`, `/api/goal-manager/*`, `/api/policy/autonomy-level`

## 2. 사전 조건

최소 권장 환경 변수:

```bash
L2_RPC_URL=http://localhost:8545
GOAL_MANAGER_ENABLED=true
GOAL_MANAGER_DISPATCH_ENABLED=true
GOAL_MANAGER_DISPATCH_DRY_RUN=true
GOAL_MANAGER_DISPATCH_ALLOW_WRITES=false
GOAL_AUTONOMY_LEVEL=A2

# write 검증 시에만 필요
SENTINAI_API_KEY=your-admin-key
NEXT_PUBLIC_SENTINAI_API_KEY=your-admin-key
```

체인별 필수:
- OP Stack/Optimism: `CHAIN_TYPE=optimism`, `L2_CHAIN_ID=<number>`
- Arbitrum Orbit: `CHAIN_TYPE=arbitrum`
- ZK Stack: `CHAIN_TYPE=zkstack`

## 3. 대시보드 검증

`http://localhost:3002`에서 `Autonomy Cockpit`을 확인한다.

1. 상태 확인
- `loop:on`
- `Goal Manager=Enabled`
- `Dispatch=On`

2. 시나리오 주입 + Goal Tick
- `Stable/Rising/Spike` 중 하나 실행
- `Goal Tick` 실행
- 기대 결과: queue depth 증가, top/suppression 갱신

3. Dispatch Dry-run
- `Dispatch Dry-run` 실행
- 기대 결과: 실패 없이 status 반환, guardrail verify 필드 갱신

4. Autonomy Level 전환
- `A2 -> A3` 전환 시도
- 기대 결과: 정책 배지 즉시 반영
- 키가 없거나 불일치면 `401 Unauthorized` 확인

## 4. API 검증

### 4.1 capabilities 조회 (MCP/API 설계 검증)

```bash
curl -s http://localhost:3002/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"get_autonomous_capabilities"}' | jq
```

기대 결과:
- 현재 `CHAIN_TYPE` 기준 intents/actions/policies 노출

### 4.2 자율 계획 생성

```bash
curl -s http://localhost:3002/api/autonomous/plan \
  -H 'content-type: application/json' \
  -d '{"intent":"recover_sequencer_path","dryRun":true,"allowWrites":false}' | jq
```

기대 결과:
- `plan.planId`, `plan.steps[]`, 체인별 action 포함

### 4.3 자율 실행 (dry-run)

```bash
curl -s http://localhost:3002/api/autonomous/execute \
  -H 'content-type: application/json' \
  -d '{"intent":"stabilize_throughput","dryRun":true,"allowWrites":false}' | jq
```

기대 결과:
- `result.success=true`
- step별 `completed/skipped` 상태

### 4.4 자율 실행 검증

```bash
curl -s http://localhost:3002/api/autonomous/verify \
  -H 'content-type: application/json' \
  -d '{"operationId":"<operation-id>","before":{"blockHeight":100},"after":{"blockHeight":101}}' | jq
```

기대 결과:
- `result.passed=true`
- check 항목에 `block_progress_ok` 또는 `component_recovered`

### 4.5 롤백 경로 검증

```bash
curl -s http://localhost:3002/api/autonomous/rollback \
  -H 'content-type: application/json' \
  -H "x-api-key: ${SENTINAI_API_KEY}" \
  -d '{"operationId":"<operation-id>","dryRun":true}' | jq
```

기대 결과:
- 실패 step가 존재하면 rollback step 실행
- 무실패인 경우 빈 rollbackSteps 반환

## 5. MCP 검증

표준 MCP 툴:
- `get_autonomous_capabilities`
- `plan_autonomous_operation`
- `execute_autonomous_operation`
- `verify_autonomous_operation`
- `rollback_autonomous_operation`

`SENTINAI_API_KEY`가 설정된 경우 write 계열(`execute_*`, `rollback_*`)은 `x-api-key` 또는 approval 정책을 충족해야 한다.

## 6. 통과 기준

- Dashboard에서 intent -> tick -> dispatch 흐름이 실패 없이 재현된다.
- API에서 plan -> execute(dry-run) -> verify -> rollback 흐름이 정상 응답한다.
- 체인 전환(`CHAIN_TYPE=optimism/arbitrum/zkstack`) 시 step action 구성이 달라진다.
- 인증 누락 시 write 요청이 차단된다(401/403).

## 7. 운영 권장

- 초기 운영은 `A2 + dry-run` 고정
- write 자동화는 `A3+`에서 승인 토큰/검증 결과를 함께 저장
- 장애 분석 시 아래 결과를 증적 보관
  - autonomous execute/verify 응답 JSON
  - `GET /api/goal-manager?limit=20`
  - `GET /api/policy/autonomy-level`
