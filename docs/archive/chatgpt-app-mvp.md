# SentinAI ChatGPT App MVP

## 1) 목표 / 범위 / 비목표

### 목표
- ChatGPT Actions를 통해 SentinAI 운영 워크플로우를 안전하게 호출할 수 있는 MVP를 1주 내 구축.
- 기존 AWS/K8s 및 MCP/Claude/Codex 기반 백엔드는 유지하고, 얇은 Adapter API만 추가.
- 기본 동작은 `dry-run`으로 운영 리스크 최소화.

### 범위 (MVP)
- Plan / Verify / Execute / Rollback / Job 조회 / Status 조회 API 제공.
- Bearer 인증 + 역할 기반 접근 제어(RBAC).
- 실행 전 `confirmToken` 검증, 허용된 액션(allowlist)만 수행.
- 감사 로그(audit log) 저장.

### 비목표
- 전체 운영 기능 100% 노출.
- 완전 자동 복구(무인 실행) 기본 활성화.
- 멀티테넌트 과금/정산, 고급 워크플로우 빌더.

## 2) 아키텍처

```text
ChatGPT (Actions)
  -> Adapter API (new, minimal)
    -> Orchestrator (policy + routing)
      -> MCP/Claude/Codex tools
      -> Existing SentinAI services
         - AWS (CloudWatch, ECS/EKS, IAM, SSM, Lambda)
         - Kubernetes (API server, metrics, rollout)
```

핵심 원칙:
- Adapter API는 인증/인가, 요청 정규화, 안전 가드(allowlist, dry-run, confirm) 담당.
- 실제 운영 로직은 기존 `src/lib` 및 기존 서비스 호출 경로를 재사용.
- 비동기 작업은 `jobId` 기반으로 추적.

## 3) 보안 모델

- 인증: Bearer Token (초기: 서비스 API Key, 이후 OAuth 2.0 전환 가능).
- 인가: RBAC (`viewer`, `operator`, `admin`) + 액션 allowlist.
- 기본 안전값: `execute`, `rollback` 요청도 기본 `dryRun=true` 권장.
- 실행 확인: `execute`, `rollback`는 `confirmToken` 필수.
- 감사 추적: 요청자, 액션, 대상, 결과, 타임스탬프, 상관관계 ID 저장.
- 비밀 관리: 토큰/키는 AWS Secrets Manager 또는 SSM Parameter Store 사용.

## 4) API 계약 개요

- `POST /v1/ops/plan`: 실행 계획 생성(영향 리소스, 위험도, 예상 변경).
- `POST /v1/ops/verify`: 사전 검증(권한/정책/리소스 상태).
- `POST /v1/ops/execute`: 실제 실행 요청(`confirmToken` 필요).
- `POST /v1/ops/rollback`: 롤백 요청(`confirmToken` 필요).
- `GET /v1/ops/jobs/{jobId}`: 비동기 작업 상태/로그 조회.
- `GET /v1/ops/status`: 어댑터 및 핵심 의존성 헬스 상태.

응답 공통 필드 예:
- `requestId`, `jobId`, `status`, `summary`, `riskLevel`, `dryRun`, `createdAt`.

## 5) 배포 토폴로지 (staging/prod)

### staging
- ChatGPT Actions (staging OpenAPI)
- Adapter API (EKS 또는 ECS, 최소 2 replicas)
- Staging AWS 계정/클러스터에만 접근
- 완화된 rate limit, 전체 감사 로그 활성화

### prod
- ChatGPT Actions (prod OpenAPI)
- Adapter API (multi-AZ, autoscaling)
- Prod 계정은 최소 권한 IAM role + 네임스페이스 제한 RBAC
- 강화된 rate limit, WAF/IP 정책, 경보 연동(Slack/PagerDuty)

## 6) 데모 스크립트 (3개)

1. 스케일 계획 제안
- 입력: "api-gateway deployment를 트래픽 대비 확장 계획 생성"
- 호출: `plan` -> `verify`
- 기대 결과: 리소스 영향도, 예상 replica 변경, 위험도 출력.

2. 안전 실행 플로우
- 입력: "방금 계획을 실제 반영"
- 호출: `execute` (`dryRun=true` 먼저) -> 확인 후 `dryRun=false` + `confirmToken`
- 기대 결과: `jobId` 발급, 상태 `running -> succeeded` 확인.

3. 롤백 시나리오
- 입력: "최근 배포 변경 롤백"
- 호출: `rollback` (`confirmToken` 포함) -> `jobs/{jobId}`
- 기대 결과: 이전 안정 버전 복구, 감사 로그에 원인/수행자 기록.

## 7) 리스크 및 완화

- 오작동 실행 리스크
  - 완화: dry-run 기본, confirmToken 의무, allowlist 제한.
- 과도한 권한 리스크
  - 완화: 최소 권한 IAM + namespace/cluster scope 제한.
- LLM 해석 오류 리스크
  - 완화: plan/verify 단계 분리, 정책 엔진에서 최종 차단.
- 장애 전파 리스크
  - 완화: circuit breaker, timeout/retry, 비동기 job 격리.
- 감사 누락 리스크
  - 완화: 모든 요청/응답 메타데이터 중앙 로그 적재.

## 8) 1주 구현 계획

- Day 1: OpenAPI 확정, Adapter API 골격(라우팅/스키마/에러 포맷)
- Day 2: Auth/RBAC/allowlist/dry-run 정책 적용
- Day 3: `plan`, `verify`를 기존 SentinAI 로직에 연결
- Day 4: `execute`, `rollback` + `confirmToken` + job queue/status
- Day 5: 감사 로그, 모니터링, staging 배포
- Day 6: ChatGPT Actions 등록/연동 테스트, 데모 리허설
- Day 7: 안정화(버그 수정, 문서 보강, 운영 핸드오프)
