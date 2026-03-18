# Agent Loop vs Goal Manager 실습 Runbook

기준일: 2026-02-24

이 문서는 동일한 부하/장애 조건에서
- `Agent Loop만 사용`
- `Agent Loop + Goal Manager 같이 사용`
을 비교해 차이를 눈으로 확인하는 실습 절차다.

## 1. 실습 목표

1. Agent Loop의 장점(빠른 즉시 대응) 확인
2. Goal Manager의 장점(중복 억제, 우선순위, DLQ/재시도) 확인
3. 운영 환경에서 둘을 함께 써야 하는 이유를 수치/로그로 검증

## 2. 사전 준비

- SentinAI 실행
  - `npm run dev` (`http://localhost:3002`)
- `.env.local` 기본 권장
  - `L2_RPC_URL` 설정
  - `AGENT_LOOP_ENABLED=true`
- 개발 실습을 위해 `NODE_ENV`는 production이 아니어야 함 (`metrics/seed` 사용)

권장 추가 설정:

```bash
GOAL_AUTONOMY_LEVEL=A2
GOAL_MANAGER_DISPATCH_DRY_RUN=true
GOAL_MANAGER_DISPATCH_ALLOW_WRITES=false
```

## 3. 관측 포인트 (공통)

대시보드:
- `Autonomy Cockpit`
  - `Queue Depth`, `suppression`, `dlq`
  - `Verify`, `degraded`
- `Agent Loop` 패널

API:

```bash
curl -s http://localhost:3002/api/agent-loop | jq '.lastCycle.phase, .lastCycle.verification, .lastCycle.degraded'
curl -s "http://localhost:3002/api/goal-manager?limit=20" | jq '.queueDepth, .queue[0], .suppression[0], .dlq[0]'
```

## 4. 실습 A: Agent Loop only

### 4.1 설정

`Goal Manager`를 끄고 재시작:

```bash
GOAL_MANAGER_ENABLED=false npm run dev
```

또는 `.env.local`에서 `GOAL_MANAGER_ENABLED=false` 후 서버 재시작.

### 4.2 부하/장애 시뮬레이션

```bash
# 1) baseline
curl -sX POST "http://localhost:3002/api/metrics/seed?scenario=stable"

# 2) tx 급증
curl -sX POST "http://localhost:3002/api/metrics/seed?scenario=spike"

# 3) 상승 패턴 유지
curl -sX POST "http://localhost:3002/api/metrics/seed?scenario=rising"
```

5~10분 관측.

### 4.3 기대 결과

- 장점:
  - Agent Loop가 빠르게 반응(사이클 단위 즉시 판단)
- 한계:
  - Goal Queue 관측 정보가 실질적으로 비어 있음
  - suppression/DLQ 기반의 구조적 정리는 보이지 않음
  - 연속 장애에서 “무엇을 어떤 순서로 처리했는지” 추적성이 약함

## 5. 실습 B: Agent Loop + Goal Manager

### 5.1 설정

`Goal Manager`를 켜고 재시작:

```bash
GOAL_MANAGER_ENABLED=true GOAL_MANAGER_DISPATCH_ENABLED=true GOAL_MANAGER_DISPATCH_DRY_RUN=true GOAL_MANAGER_DISPATCH_ALLOW_WRITES=false npm run dev
```

### 5.2 동일 시나리오 재실행

```bash
curl -sX POST "http://localhost:3002/api/metrics/seed?scenario=stable"
curl -sX POST "http://localhost:3002/api/metrics/seed?scenario=spike"
curl -sX POST "http://localhost:3002/api/metrics/seed?scenario=rising"
```

대시보드에서 추가로 실행:
- `Goal Tick`
- `Dispatch Dry-run`

### 5.3 기대 결과

- `Queue Depth`가 유의미하게 변함
- 유사 목표가 `suppression`으로 억제됨
- 실패/재시도 경로가 `dlq`로 남아 재처리 근거 제공
- 즉시 반응(Agent Loop) + 구조적 관리(Goal Manager)가 동시에 보임

## 6. 비교 체크리스트

| 항목 | Agent Loop only | Agent Loop + Goal Manager |
|---|---|---|
| 즉시 반응 속도 | 빠름 | 빠름 |
| 중복 액션 억제 | 제한적 | `suppression`으로 명시적 관리 |
| 우선순위/순서 제어 | 제한적 | Goal Queue 기반 제어 |
| 실패 처리 가시성 | 낮음 | DLQ/재시도로 높음 |
| 실행 근거 추적성 | 중간 | 높음 |

## 7. 결론 기준 (Pass/Fail)

Pass 조건:
1. 동일 시나리오에서 B(Loop+Goal)가 A 대비 `queue/suppression/dlq` 가시성을 제공한다.
2. B에서 `Goal Tick -> Dispatch Dry-run` 흐름이 재현된다.
3. 운영자가 액션 순서/재시도/실패 사유를 API 응답으로 설명할 수 있다.

Fail 조건:
1. B에서도 queue/suppression/dlq가 계속 0이고 변화가 없다.
2. Goal Tick/Dispatch가 반복 실패하고 원인 구분이 불가능하다.

## 8. 실무 권장안

- 실시간 급변 대응은 Agent Loop가 담당
- 운영 안정성(중복 억제/우선순위/실패 처리/재처리)은 Goal Manager가 담당
- 따라서 프로덕션 권장 구조는 `Agent Loop + Goal Manager` 병행이다.

## 9. 관련 문서

- `docs/guide/agent-loop-vs-goal-manager-demo-15min.md`
- `docs/guide/agent-loop-vs-goal-manager-demo-speaker-script.md`
- `docs/guide/autonomy-cockpit-user-guide.md`
- `docs/guide/runbook/multistack-autonomous-ops-validation.md`
- `docs/guide/runbook/stack-environment-operations-decision-matrix.md`
- `docs/spec/agent-loop-vs-goal-manager.md`
