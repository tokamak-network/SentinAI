# SentinAI ChatGPT App Quickstart (MVP)

이 문서는 ChatGPT에서 SentinAI Actions를 등록하고 안전하게 테스트하는 최소 절차를 설명합니다.

## 1) 사전 준비
- 배포된 Adapter API 엔드포인트
  - 예: `https://sentinai.tokamak.network/thanos-sepolia`
- Bearer 토큰(테스트용 최소 권한)
- OpenAPI 스펙 파일: `docs/openapi/chatgpt-actions.yaml`

## 2) ChatGPT Actions 등록
1. ChatGPT에서 새 Custom GPT를 생성합니다.
2. `Configure` 탭에서 `Actions` 섹션으로 이동합니다.
3. `Import from OpenAPI`를 선택하고 `docs/openapi/chatgpt-actions.yaml` 내용을 붙여넣습니다.
4. 서버 URL을 설정합니다: `https://sentinai.tokamak.network/thanos-sepolia`
5. 인증 방식은 `Bearer`를 선택하고 테스트 토큰을 입력합니다 (`SENTINAI_ADAPTER_VIEWER_TOKEN` 값).

## 3) 권장 안전 기본값
- 시작 환경은 반드시 `staging`.
- `execute`/`rollback`는 최초에 `dryRun=true`로만 호출.
- `confirmToken`은 운영자 승인 후에만 발급/사용.
- allowlist 외 액션은 API에서 거부되도록 정책 고정.

## 4) 기본 호출 테스트 순서
1. `GET /v1/ops/status`
- 목적: 연결/인증/의존성 상태 확인.

2. `POST /v1/ops/plan`
- 예시 입력: `action=scale_service`, `target.environment=staging`.
- 확인: `planId`, `riskLevel`, `proposedChanges`.

3. `POST /v1/ops/verify`
- 입력: 직전 `planId`.
- 확인: `jobId` 수신 후 `GET /v1/ops/jobs/{jobId}`의 `result.verified=true` 및 `result.blockingIssues` 없음.

4. `POST /v1/ops/execute` (`dryRun=true`)
- 입력: `planId`, `confirmToken`, `dryRun=true`.
- 확인: `jobId` 수신.

5. `GET /v1/ops/jobs/{jobId}`
- 확인: `status`가 `running -> succeeded`로 전이.

## 5) 운영 전환 체크
- staging에서 최소 3개 시나리오(계획/실행/롤백) 재현.
- 감사 로그에 요청자/액션/결과가 누락 없이 기록되는지 확인.
- prod 토큰은 별도 발급(짧은 만료 시간, 최소 권한).

## 6) Troubleshooting

- 401 Unauthorized
  - 원인: 토큰 만료/형식 오류.
  - 조치: Bearer 값 재발급, 헤더 형식(`Authorization: Bearer ...`) 확인.

- 403 Forbidden
  - 원인: RBAC 또는 allowlist 정책 불일치.
  - 조치: 역할(`viewer/operator/admin`)과 요청 액션 매핑 검토.

- 400 Bad Request (confirmToken 관련)
  - 원인: `execute`/`rollback`에서 `confirmToken` 누락 또는 불일치.
  - 조치: 승인된 토큰 재생성 후 재시도.

- job이 `failed`
  - 원인: 대상 리소스 상태 불일치, 정책 차단, 백엔드 의존성 오류.
  - 조치: `jobs/{jobId}` 로그와 Adapter API 감사 로그를 함께 확인.

- 상태가 `degraded`
  - 원인: AWS/K8s/MCP 의존성 일부 장애.
  - 조치: `GET /v1/ops/status`의 dependency detail 기반으로 장애 컴포넌트 우선 복구.

---

## 7) 확장 API - 대시보드 기능 전체 접근

기본 작업(`plan/verify/execute/rollback`) 외에, SentinAI 대시보드가 제공하는 모든 핵심 기능을 ChatGPT에서 직접 조회/제어할 수 있습니다.

### 7.1 네트워크 상태 조회
```
GET /v1/network/metrics — L1/L2 블록, TxPool, CPU, 컴포넌트 상태
  역할: viewer
  응답: { timestamp, chain, metrics(l1BlockHeight, blockHeight, txPoolCount, cpuUsage, ...), components, status }

GET /v1/network/l1-failover — L1 RPC 페일오버 현황
  역할: viewer
  응답: { activeUrl, failoverCount, healthy, lastFailover, poolSize, status }
```

### 7.2 스케일링 제어
```
GET /v1/scaling/status — 현재 vCPU, 자동 스케일링 상태, AI 예측
  역할: viewer
  응답: { currentVcpu, autoScalingEnabled, cooldownRemaining, prediction(predictedVcpu, confidence, trend, ...) }

POST /v1/scaling/trigger — 수동 스케일 트리거 (operator 이상)
  역할: operator
  요청: { targetVcpu: 1|2|4|8, reason?: string, dryRun: true|false }
  응답: { success, jobId, message }
  주의: dryRun=true 기본값 반드시 유지. 실제 실행할 때만 dryRun=false로 변경.
```

### 7.3 이상 감지 / 비용 / 에이전트
```
GET /v1/anomalies?limit=20&offset=0 — 최근 이상 이벤트
  역할: viewer
  응답: { events[], total, activeCount }

GET /v1/cost/report?days=7 — N일 비용 분석
  역할: viewer
  응답: { period, totalCost, fixedCost, dynamicCost, savingsRate, recommendations[] }

GET /v1/agent/loop?limit=50 — 에이전트 루프 사이클 이력
  역할: viewer
  응답: { scheduler, lastCycle, recentCycles, totalCycles, enabled }

GET /v1/agent/decisions?limit=50&severity=high — 에이전트 결정 이력
  역할: viewer
  응답: { traces[], total }
```

### 7.4 자율화 정책
```
GET /v1/policy/autonomy-level — 현재 레벨 조회
  역할: viewer
  응답: { policy: { level: A0|A1|A2|A3|A4|A5, minConfidenceDryRun, minConfidenceWrite } }

POST /v1/policy/autonomy-level — 레벨 변경 (admin 전용)
  역할: admin
  요청: { level: A0|A1|A2|A3|A4|A5 }
  응답: { policy: { ... } }
  설명:
    A0 = 수동전용 (모든 액션 수동 승인)
    A1 = 권고 (AI 권고만 제시)
    A2 = DryRun 허용 (건조 실행 자동화)
    A3 = 낮은 신뢰 자율 (신뢰도 >60% 자동 실행)
    A4 = 중간 신뢰 자율 (신뢰도 >80% 자동 실행)
    A5 = 완전 자율 (모든 액션 자동 실행)
```

### 7.5 NLOps 자연어 운영
```
POST /v1/nlops — 자연어 명령
  역할: operator
  URL: https://sentinai.tokamak.network/thanos-sepolia/v1/nlops
  요청: { message: "현재 시스템 상태 알려줘" }
  응답: { intent, executed, response, needsConfirmation?, data? }

  위험한 액션 (scale, config) 처리:
    1. 첫 요청: { message: "op-geth를 2개로 스케일링해줘" }
       → 응답: { needsConfirmation: true, confirmationMessage: "op-geth를 2개 복제본으로 스케일링 하시겠습니까?" }
    2. 최종 확인: { message: "op-geth를 2개로 스케일링해줘", confirmAction: true }
       → 응답: { executed: true, response: "스케일링이 진행 중입니다..." }
```

---

## 8) 역할별 접근 가능 엔드포인트 매트릭스

| 엔드포인트 | viewer | operator | admin |
|-----------|--------|----------|-------|
| **Operations** | | | |
| `POST /v1/ops/plan` | O | O | O |
| `POST /v1/ops/verify` | O | O | O |
| `POST /v1/ops/execute (dryRun)` | - | O | O |
| `POST /v1/ops/execute (live)` | - | - | O |
| `POST /v1/ops/rollback` | - | - | O |
| `GET /v1/ops/jobs/{jobId}` | O | O | O |
| `GET /v1/ops/status` | O | O | O |
| **Network** | | | |
| `GET /v1/network/metrics` | O | O | O |
| `GET /v1/network/l1-failover` | O | O | O |
| **Scaling** | | | |
| `GET /v1/scaling/status` | O | O | O |
| `POST /v1/scaling/trigger` | - | O | O |
| **Anomalies** | | | |
| `GET /v1/anomalies` | O | O | O |
| **Cost** | | | |
| `GET /v1/cost/report` | O | O | O |
| **Agent** | | | |
| `GET /v1/agent/loop` | O | O | O |
| `GET /v1/agent/decisions` | O | O | O |
| **Policy** | | | |
| `GET /v1/policy/autonomy-level` | O | O | O |
| `POST /v1/policy/autonomy-level` | - | - | O |
| **NLOps** | | | |
| `POST /v1/nlops` | - | O | O |

---

## 9) 권장 ChatGPT 프롬프트 패턴

### 9.1 시스템 상태 조회 시작점
```
1. "현재 Adapter API 상태를 확인해줘"
   → GET /v1/ops/status → 연결 확인

2. "네트워크 상태는 어떻게 되나?"
   → GET /v1/network/metrics → L1/L2 블록, TxPool, CPU 확인

3. "스케일링 현황을 알려줘"
   → GET /v1/scaling/status → 현재 vCPU, AI 예측, 쿨다운 조회
```

### 9.2 이상 감지 → RCA → 조치 흐름
```
1. "최근 이상 감지 이벤트를 보여줘"
   → GET /v1/anomalies?limit=5

2. "이 이상의 원인을 분석해줘"
   → POST /v1/nlops { message: "최근 이상 원인을 분석해줘" }

3. "op-geth 스케일링으로 해결하는 계획을 세워줘"
   → POST /v1/ops/plan { action: "stabilize_throughput", target: {...} }

4. "계획을 검증해줘"
   → POST /v1/ops/verify { planId: "..." }

5. "건조 실행으로 테스트해줘"
   → POST /v1/ops/execute { planId: "...", dryRun: true }

6. "결과를 확인해줘"
   → GET /v1/ops/jobs/{jobId}

7. "실제로 실행해줘"
   → POST /v1/ops/execute { planId: "...", confirmToken: "...", dryRun: false }
```

### 9.3 비용 최적화 시나리오
```
1. "최근 7일 비용 분석해줘"
   → GET /v1/cost/report?days=7

2. "비용 절감 추천에 따라 스케일 다운해줄래?"
   → POST /v1/nlops { message: "cost report 기반 스케일 다운 실행해줘" }
```

### 9.4 자율화 정책 조정
```
1. "현재 자율화 레벨은?"
   → GET /v1/policy/autonomy-level

2. "자율화 레벨을 A2(DryRun 허용)로 올려줄래?"
   → POST /v1/policy/autonomy-level { level: "A2" }
   (admin 역할 필요)
```
