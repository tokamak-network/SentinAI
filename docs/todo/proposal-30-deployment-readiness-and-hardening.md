# Proposal 30: User Deployment Readiness and Hardening

> 작성일: 2026-02-26  
> 상태: Draft

## 1) 목적

사용자가 SentinAI를 직접 배포할 때 실패율을 낮추고, 보안/운영 안정성을 높이는 개선안을 정의한다.

범위:
- 배포 동선 점검 (문서 + 설치 스크립트)
- 운영자 관점 실패 포인트 식별
- 즉시 개선안 + 2주 실행 계획 제안

## 2) 현재 배포 방식 점검 결과

현재 제공 경로:
1. 로컬 개발: `docs/guide/quickstart.md`, `docs/guide/setup.md`
2. 서버 자동 설치: `scripts/setup-server.sh` + `scripts/install.sh`
3. 비대화형 설치: 환경변수 기반 `install.sh` 실행 (CI/CD, user-data)
4. EC2 가이드: `docs/guide/ec2-setup-guide.md`

강점:
- 단일 스크립트로 Docker/Compose/Git/AWS CLI/쿠버 설정까지 자동화
- `core/advanced` 모드 분리로 초기 진입 장벽 낮음
- 설치 후 health check retry 및 대시보드 URL 안내 제공

갭(중요):
1. 문서-실행 동작 불일치
- `quickstart`의 seed API 예시는 인증 헤더 미포함
- `quickstart`의 health 응답 예시 스키마가 현재 구현과 다름
- `setup.md`는 install.sh가 firewall까지 처리한다고 안내하지만 실제 firewall은 `setup-server.sh` 영역

2. 공급망/릴리즈 고정성 부족
- 권장 설치가 `curl | bash` + `main` 브랜치 기반으로 mutable
- 특정 커밋/태그 고정, checksum 검증 경로가 기본값이 아님

3. 운영 검증이 health 중심으로 제한
- 설치 완료 판정이 `/api/health` 1개 엔드포인트 중심
- 실사용 핵심 경로(메트릭/goal-manager/auth/read-only/policy) smoke 검증 부재

4. 시크릿 취급 리스크
- user-data에 API key 직접 삽입 예시가 있음
- root 경로로 AWS/kube config 복사 전략은 동작성은 높지만 최소권한/감사 측면 보완 필요

5. 업데이트/롤백 플로우 약함
- 운영 업데이트가 `git pull + build + up -d` 중심
- 실패 시 자동 롤백 절차/버전 고정 체크포인트가 기본 제공되지 않음

## 3) 우선순위 개선안

## P0 (즉시, 1-2일)

1. 배포 문서 정합성 수정
- `docs/guide/quickstart.md`
  - seed 요청에 `x-api-key` 필요 조건 명시
  - health 예시 응답을 현재 스키마로 갱신
- `docs/guide/setup.md`
  - firewall 책임을 `setup-server.sh`로 명확히 분리

2. 설치 후 기본 smoke 검증 추가
- `scripts/install.sh` 완료 직후 선택적 smoke 실행:
  - `/api/health`
  - `/api/agent-loop`
  - `/api/goal-manager?limit=1` (읽기)
- 실패 시 “원인 분류 메시지 + 다음 조치” 출력

3. 비대화형 설치 최소 입력 검증 강화
- `L2_RPC_URL`/AI key 외에 `SENTINAI_API_KEY` 필요 시점을 명확히 검증
- 잘못된 `CHAIN_TYPE`/`ORCHESTRATOR_TYPE` 오류 메시지 표준화

## P1 (단기, 1주)

1. 버전 고정 배포 경로 추가
- `install.sh`에 `SENTINAI_REF`(tag/commit) 옵션 추가
- 문서 기본 예시를 `main` 대신 `release tag` 우선으로 제시

2. 보안형 설치 모드 추가
- `INSTALL_SECURITY_MODE=strict` 도입:
  - user-data 평문 키 사용 경고 강화
  - SSM/Secrets Manager 사용 가이드 링크 및 체크
  - 불필요 root 복사 최소화 옵션

3. 사전 점검 명령 제공
- `scripts/preflight-check.sh` 신규:
  - DNS, 포트, AWS 인증, EKS 접근, RPC 연결성 점검
  - 결과를 PASS/FAIL 표로 출력

## P2 (중기, 2주)

1. 운영 업데이트/롤백 자동화
- `scripts/deploy-update.sh` 신규:
  - 현재 버전 스냅샷
  - 새 버전 배포
  - smoke 실패 시 자동 rollback

2. 배포 품질 게이트 문서화
- “배포 완료” 기준을 health가 아닌 다중 체크로 격상:
  - API 응답성
  - read-only 정책 동작
  - goal tick dry-run
  - 로그 에러율

3. 인스턴스 프로파일별 권장안
- 소형/표준/고가용성(단일/이중) 배포 템플릿 제시

## 4) 실행 계획 (2주)

Week 1:
1. P0 문서 정합성 수정
2. install 후 smoke 추가
3. preflight-check 스크립트 배포

Week 2:
1. SENTINAI_REF 기반 버전 고정 배포 지원
2. deploy-update + rollback 스크립트
3. 보안형 설치 모드(strict) 초안

## 5) 수용 기준 (DoD)

1. 신규 사용자가 문서만 보고 1회 설치 성공률 90% 이상
2. 설치 후 smoke 체크 통과율/실패 원인 자동 분류 제공
3. 태그/커밋 고정 배포 경로 제공
4. 배포 실패 시 원클릭 rollback 절차 문서/스크립트 제공

## 6) 즉시 착수 체크리스트

- [ ] quickstart/setup 문서 정합성 패치
- [ ] `scripts/preflight-check.sh` 추가
- [ ] `install.sh` post-install smoke 확장
- [ ] `SENTINAI_REF` 옵션 설계/적용
- [ ] `deploy-update.sh` rollback 포함 초안 작성
