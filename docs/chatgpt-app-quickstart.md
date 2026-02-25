# SentinAI ChatGPT App Quickstart (MVP)

이 문서는 ChatGPT에서 SentinAI Actions를 등록하고 안전하게 테스트하는 최소 절차를 설명합니다.

## 1) 사전 준비
- 배포된 Adapter API 엔드포인트
  - 예: `https://api-staging.sentinai.example.com`
- Bearer 토큰(테스트용 최소 권한)
- OpenAPI 스펙 파일: `docs/openapi/chatgpt-actions.yaml`

## 2) ChatGPT Actions 등록
1. ChatGPT에서 새 Custom GPT를 생성합니다.
2. `Configure` 탭에서 `Actions` 섹션으로 이동합니다.
3. `Import from OpenAPI`를 선택하고 `docs/openapi/chatgpt-actions.yaml` 내용을 붙여넣습니다.
4. 서버 URL을 staging으로 설정합니다.
5. 인증 방식은 `Bearer`를 선택하고 테스트 토큰을 입력합니다.

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
