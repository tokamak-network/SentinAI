# Autonomy Cockpit 사용자 가이드

## 1. 목적

`Autonomy Cockpit`은 SentinAI 대시보드에서 자율 에이전트 상태를 한 화면에서 확인하고,
데모 시나리오 주입/Goal Tick/Dispatch Dry-run을 실행하기 위한 운영 패널입니다.

대상:
- 운영자 (Operator)

---

## 2. 사전 준비

### 2.1 필수 환경 변수

`.env.local` 기준 최소 권장값:

```bash
# Agent Loop 활성화(자동)
L2_RPC_URL=https://your-l2-rpc.example.com

# Goal Manager
GOAL_MANAGER_ENABLED=true
GOAL_MANAGER_DISPATCH_ENABLED=true
GOAL_MANAGER_DISPATCH_DRY_RUN=true
GOAL_MANAGER_DISPATCH_ALLOW_WRITES=false

# Runtime autonomy 기본값(선택)
GOAL_AUTONOMY_LEVEL=A2
GOAL_AUTONOMY_MIN_CONFIDENCE_DRY_RUN=0.35
GOAL_AUTONOMY_MIN_CONFIDENCE_WRITE=0.65
```

### 2.2 정책 변경/디스패치 버튼을 쓸 때

`Autonomy Level` 변경, `Dispatch Dry-run` 실행은 write API 호출이므로 API 키 정합성이 필요합니다.

```bash
# 서버 인증 키
SENTINAI_API_KEY=your-admin-key

# 대시보드(write header 주입용) - 서버 키와 동일 값
NEXT_PUBLIC_SENTINAI_API_KEY=your-admin-key
```

주의:
- `NEXT_PUBLIC_*` 값은 브라우저에 노출됩니다.
- 내부망/데모 환경에서만 사용하고, 외부 공개 환경에서는 별도 접근제어(SSO/VPN/IP 제한)를 권장합니다.

### 2.3 개발/운영 모드 차이

- `Stable/Rising/Spike` 버튼은 `POST /api/metrics/seed`를 호출합니다.
- 이 엔드포인트는 `NODE_ENV=production`에서 403으로 차단됩니다.
- 운영 환경에서는 seed 주입 대신 실제 트래픽 기반 상태만 관찰하세요.

---

## 3. 패널 구성 이해

대시보드의 `Autonomy Cockpit` 패널은 아래 4개 영역으로 구성됩니다.

### 3.1 상단 배지

- `A0~A5`: 현재 런타임 자율 정책 레벨
- `loop:on/off`: Agent Loop 활성 상태 (`/api/agent-loop`)

### 3.2 Engine Status

- `Goal Manager`: 후보 생성/큐 관리 엔진 활성 여부
- `Dispatch`: 디스패치 실행 가능 여부
- `Dispatch Mode`: `dry-run` 또는 `write`

### 3.3 Goal Queue

- `Queue Depth`: queued/scheduled/running 상태 목표 개수
- `Active Goal`: 현재 처리 중인 goal id(축약)
- `top`: 큐 최상단 goal 요약
- `suppression`: 억제된 후보 수
- `dlq`: 실패 후 DLQ로 이동한 항목 수

### 3.4 Guardrails

- `Read-Only`: 읽기 전용 모드 여부
- `Verify`: 최근 실행 검증 결과(PASS/FAIL/N/A)
- `Approval (Write)`: write 계열 승인 요구 상태
- `degraded`: 최근 degraded 사유

---

## 4. Autonomy Level (A0~A5)

| 레벨 | Permission | Guardrail |
|---|---|---|
| A0 | Observe only, no autonomous execution | 모든 실행 수동 승인 필요 |
| A1 | 추천 생성 가능, 실행은 수동 트리거 | 자동 dispatch 비활성 |
| A2 | 자율 dry-run 실행 허용 | write 실행 차단, 승인 필요 |
| A3 | low-risk goal write 실행 허용 | 검증 실패 시 degraded 모드 전환 |
| A4 | medium-risk goal까지 자동 실행 확장 | 승인/검증/감사 로그 강제 |
| A5 | high-risk 포함 최대 자율 | 사후 검증 실패 시 자동 롤백 |

참고:
- 패널 하단에 현재 `dry-run threshold`, `write threshold`가 표시됩니다.
- 레벨 버튼 hover 시 Permission/Guardrail 툴팁으로 확인 가능합니다.

---

## 5. 기본 사용 절차

### 5.1 상태 확인

1. `Autonomy Cockpit` 패널이 표시되는지 확인
2. 상단이 `loop:on`인지 확인
3. `Engine Status`에서 `Goal Manager=Enabled`, `Dispatch=On`인지 확인

### 5.2 시나리오 주입 (개발 모드)

1. `Stable` / `Rising` / `Spike` 중 하나 클릭
2. 피드백 메시지 확인
   - 예: `Scenario spike injected (20 data points)`

### 5.3 Goal Tick 실행

1. `Goal Tick` 클릭
2. 피드백 메시지 확인
   - 예: `Goal tick completed (generated 4, queued 2, queue depth 2)`
3. `Queue Depth`, `top`, `suppression` 변화 확인

### 5.4 Dry-run Dispatch 실행

1. `Dispatch Dry-run` 클릭
2. 피드백 메시지 확인
   - 예: `Dry-run dispatch completed (status: dispatched)`
3. `Guardrails`의 verify/degraded와 `Goal Queue` 상태를 함께 확인

### 5.5 자율 레벨 변경

1. `A0~A5` 버튼 중 목표 레벨 클릭
2. 성공 메시지 확인
   - 예: `Autonomy level changed to A3.`
3. 상단 레벨 배지와 현재 정책 설명이 즉시 바뀌는지 확인

---

## 6. UI 액션과 API 매핑

| UI 액션 | API | 인증 조건 | 비고 |
|---|---|---|---|
| Stable/Rising/Spike | `POST /api/metrics/seed?scenario=<name>` | 기본적으로 API 키 불필요 | 개발 모드 전용 (`production` 차단) |
| Goal Tick | `POST /api/goal-manager/tick` | `SENTINAI_API_KEY` 설정 시 `x-api-key` 필요 | 큐 생성/억제 계산 수행 |
| Dispatch Dry-run | `POST /api/goal-manager/dispatch` (`dryRun=true`, `allowWrites=false`) | `x-api-key` 필요 | 라우트에서도 admin 키 재검증 |
| Autonomy Level 버튼 | `POST /api/policy/autonomy-level` | `x-api-key` 필요 | 레벨/임계치 런타임 갱신 |
| 상태 패널 polling | `GET /api/goal-manager?limit=20`, `GET /api/policy/autonomy-level`, `GET /api/agent-loop` | 불필요 | 약 30초 주기 갱신 |

---

## 7. 트러블슈팅

### 7.1 `Changing policy level requires NEXT_PUBLIC_SENTINAI_API_KEY`

원인:
- 브라우저에서 write API 헤더를 만들 키가 없음

조치:
1. `.env.local`에 `SENTINAI_API_KEY`, `NEXT_PUBLIC_SENTINAI_API_KEY`를 동일 값으로 설정
2. 서버 재시작

### 7.2 `Unauthorized: invalid or missing x-api-key`

원인:
- 서버 키(`SENTINAI_API_KEY`)와 요청 키 불일치

조치:
1. 서버 env와 브라우저 env 값 일치 여부 확인
2. reverse proxy가 `x-api-key` 헤더를 제거하지 않는지 확인

### 7.3 `This endpoint is only available in development mode`

원인:
- `metrics/seed`는 운영 모드에서 차단

조치:
1. 운영에서는 seed 주입 버튼 대신 실제 메트릭으로 검증
2. 데모가 필요하면 개발 환경에서 진행

### 7.4 Queue가 계속 0

원인:
- Goal Manager 비활성
- 신호 대비 후보 생성/큐잉 조건 미충족

조치:
1. `GOAL_MANAGER_ENABLED=true` 확인
2. `GOAL_MANAGER_DISPATCH_ENABLED=true` 확인
3. `Goal Tick` 후 feedback의 generated/queued 값을 먼저 확인

### 7.5 `loop:off`

원인:
- Agent Loop 비활성 (`L2_RPC_URL` 미설정 또는 `AGENT_LOOP_ENABLED=false`)

조치:
1. `L2_RPC_URL` 설정
2. 필요 시 `AGENT_LOOP_ENABLED=true` 명시

---

## 8. 운영 권고

1. 초기 운영은 `A2 + dry-run` 조합으로 시작하세요.
2. write 실행은 `A3` 이상으로 올리기 전에 검증/롤백 절차를 먼저 점검하세요.
3. `GOAL_MANAGER_DISPATCH_ALLOW_WRITES=true` 전환 전, 최소 1일 이상 dry-run 결과를 누적 확인하세요.
4. 사고 분석 시 `Autonomy Cockpit` 상태와 함께 아래 API를 같이 보관하세요.

```bash
curl -s http://localhost:3002/api/agent-loop | jq '.lastCycle.phase, .lastCycle.verification, .lastCycle.degraded'
curl -s "http://localhost:3002/api/goal-manager?limit=20" | jq '.queueDepth, .queue[0], .suppression[0], .dlq[0]'
curl -s http://localhost:3002/api/policy/autonomy-level | jq '.policy'
```

---

## 9. 관련 문서

- `docs/guide/agentic-q1-operations-runbook.md`
- `docs/guide/sentinai-mcp-user-guide.md`
- `docs/guide/demo-scenarios.md`
