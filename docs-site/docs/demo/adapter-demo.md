# SentinAI Adapter API (ChatGPT Actions) — 1차 데모 절차

## 0) 준비

### 환경 변수 (로컬)
`.env.local`에 아래를 추가 (민감정보 하드코딩 금지: 로컬에서만 설정)

```bash
# Bearer 토큰 3단계 (역할 기반)
SENTINAI_ADAPTER_VIEWER_TOKEN=viewer-demo-token
SENTINAI_ADAPTER_OPERATOR_TOKEN=operator-demo-token
SENTINAI_ADAPTER_ADMIN_TOKEN=admin-demo-token

# (옵션) live 실행 방지 기본값: false
# live 실행을 정말 허용하려면 true로
SENTINAI_ADAPTER_ALLOW_LIVE_EXECUTION=false
```

### 서버 실행
```bash
npm run dev
# 기본: http://localhost:3000
```

## 1) 공통: 헤더
```bash
export BASE=http://localhost:3000
export VIEWER=viewer-demo-token
export OPERATOR=operator-demo-token
export ADMIN=admin-demo-token
```

## 2) 시나리오 A — L1 RPC 연결/Failover 복구 (dry-run)

### (1) Plan
```bash
curl -sS "$BASE/v1/ops/plan" \
  -H "Authorization: Bearer $VIEWER" \
  -H 'Content-Type: application/json' \
  -d '{
    "requestId":"demo-a-1",
    "action":"restore_l1_connectivity",
    "target":{"environment":"staging","platform":"k8s","service":"op-node"},
    "dryRun": true
  }' | jq
```

**예상 응답 (요지)**
- `planId`
- `confirmToken`
- `dryRun: true`

### (2) Verify (async job)
```bash
PLAN_ID=<planId>
VERIFY_JOB=$(curl -sS "$BASE/v1/ops/verify" \
  -H "Authorization: Bearer $OPERATOR" \
  -H 'Content-Type: application/json' \
  -d '{
    "requestId":"demo-a-2",
    "planId":"'"$PLAN_ID"'",
    "target":{"environment":"staging","platform":"k8s","service":"op-node"}
  }')

echo "$VERIFY_JOB" | jq
VERIFY_JOB_ID=$(echo "$VERIFY_JOB" | jq -r .jobId)

# 완료까지 폴링
curl -sS "$BASE/v1/ops/jobs/$VERIFY_JOB_ID" -H "Authorization: Bearer $VIEWER" | jq
```

### (3) Execute (confirmToken 필수, async job)
```bash
CONFIRM=<confirmToken>
EXEC_JOB=$(curl -sS "$BASE/v1/ops/execute" \
  -H "Authorization: Bearer $OPERATOR" \
  -H 'Content-Type: application/json' \
  -d '{
    "requestId":"demo-a-3",
    "planId":"'"$PLAN_ID"'",
    "confirmToken":"'"$CONFIRM"'",
    "target":{"environment":"staging","platform":"k8s","service":"op-node"},
    "dryRun": true,
    "reason":"demo"
  }')

echo "$EXEC_JOB" | jq
EXEC_JOB_ID=$(echo "$EXEC_JOB" | jq -r .jobId)

# 완료까지 폴링 (result.operationId 포함)
curl -sS "$BASE/v1/ops/jobs/$EXEC_JOB_ID" -H "Authorization: Bearer $VIEWER" | jq
```

### (4) Job 조회 (선택)
```bash
JOB_ID=<jobId>
curl -sS "$BASE/v1/ops/jobs/$JOB_ID" \
  -H "Authorization: Bearer $VIEWER" | jq
```

### (5) Rollback (operationId/sourceJobId 기반, admin only)
```bash
# sourceJobId에 (3)에서 나온 execute jobId를 넣는 것을 권장
ROLLBACK_JOB=$(curl -sS "$BASE/v1/ops/rollback" \
  -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' \
  -d '{
    "requestId":"demo-a-rollback-1",
    "sourceJobId":"'"$EXEC_JOB_ID"'",
    "confirmToken":"'"$CONFIRM"'",
    "dryRun": true
  }')

echo "$ROLLBACK_JOB" | jq
ROLLBACK_JOB_ID=$(echo "$ROLLBACK_JOB" | jq -r .jobId)

curl -sS "$BASE/v1/ops/jobs/$ROLLBACK_JOB_ID" -H "Authorization: Bearer $VIEWER" | jq
```

## 3) 시나리오 B — Idle window 비용 절감 (downscale) (dry-run)

```bash
curl -sS "$BASE/v1/ops/plan" \
  -H "Authorization: Bearer $VIEWER" \
  -H 'Content-Type: application/json' \
  -d '{
    "requestId":"demo-b-1",
    "action":"reduce_cost_idle_window",
    "target":{"environment":"staging","platform":"k8s","service":"op-batcher"},
    "parameters": {"targetReplicas": 1},
    "dryRun": true
  }' | jq
```

(이후 Verify/Execute는 시나리오 A와 동일)

## 4) 시나리오 C — EOA 잔고 보호 (script-only 준비)

```bash
curl -sS "$BASE/v1/ops/plan" \
  -H "Authorization: Bearer $VIEWER" \
  -H 'Content-Type: application/json' \
  -d '{
    "requestId":"demo-c-1",
    "action":"protect_critical_eoa",
    "target":{"environment":"staging","platform":"aws","service":"eoa-balance"},
    "dryRun": true
  }' | jq
```

## 5) Status (Adapter 상태)
```bash
curl -sS "$BASE/v1/ops/status" \
  -H "Authorization: Bearer $VIEWER" | jq
```

## 6) 정책 확인 포인트
- **Auth**: Authorization Bearer 없으면 401
- **Role**:
  - plan/status/jobs: viewer 이상
  - verify/execute: operator 이상
  - rollback: admin
- **confirmToken**: execute/rollback 요청에 필수 + plan 단계 발급값과 일치해야 함
- **dry-run 기본**: request body에서 `dryRun` 생략 시 true로 처리
- **live 실행 차단**: `dryRun:false`는 admin + `SENTINAI_ADAPTER_ALLOW_LIVE_EXECUTION=true` 필요
