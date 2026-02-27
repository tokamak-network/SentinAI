# Proposal 31: Client Auto-Customization, Onboarding, and Ownership Model

> Date: 2026-02-27  
> Owner: SentinAI Core  
> Scope: L1/L2 client onboarding automation, capability auto-customization, landing connect flow, self-hosted ownership model

---

## 1) Background

현재 SentinAI는 체인/스택별 기본 분기(ChainPlugin)는 가능하지만, 신규 운영자가 노드 엔드포인트를 등록했을 때
`자동 감지 -> 자동 capability 매핑 -> 자동 UI/agent 연동`까지 완전히 닫힌 흐름은 부족하다.

목표는 다음 한 문장으로 정의한다.

- "노드 운영자는 URL과 인증 정보만 입력하면, SentinAI가 클라이언트를 감지하고 필요한 운영 기능을 자동으로 커스터마이징해 즉시 운영 가능한 상태를 만든다."
- "온보딩이 끝나면 백엔드가 노드를 등록하고 사용자에게 즉시 접근 가능한 대시보드 URL을 반환한다."
- "가능하면 운영자 환경에 SentinAI를 배치해 대시보드와 운영 데이터의 소유권을 사용자에게 둔다."

---

## 2) Gap Summary

### 2.1 Backend Gap

1. 등록된 인스턴스의 표준 리소스 모델이 약함 (`NodeInstance`, `DetectedCapabilities`, `CredentialProfile` 일관 저장 부족)
2. 커넥터/수집기 연결 검증과 클라이언트 자동 식별 로직이 통합 API로 제공되지 않음
3. 감지 결과를 plan/execute/verify와 연결하는 정책 경로가 약함
4. 자동화 실행 전 안전 경계(dry-run/approval/rollback)의 인스턴스 단위 정책이 부족함

### 2.2 Frontend Gap (Landing / Connect)

1. "Connect Your Node" 플로우가 실제 등록 API와 완전 결합되지 않음
2. 연결 테스트 결과가 capability/권한 요구사항까지 안내하지 못함
3. 등록 완료 후 대시보드 자동 생성 및 인스턴스 상태 카드 연동이 부족함

---

## 3) Target Architecture Changes

## 3.1 Backend

> **컨텍스트**: 이 API들은 사용자 인프라에서 실행되는 SentinAI 컨테이너 내부 API다.
> 외부 중앙 서버가 없으며, 랜딩 마법사(website)가 아닌 SentinAI 자체가 호출한다.

1. **Instance Control Plane**
- `NodeInstance` 저장소 확정: `instanceId`, `nodeType`, `protocolId`, `connectionConfig`, `securityProfile`, `policyProfile`
- Redis namespace: `inst:{id}:meta`, `inst:{id}:metrics:*`, `inst:{id}:anomaly:*`, `inst:{id}:agent:*`
- 인스턴스는 환경변수(`L2_RPC_URL`, `SENTINAI_L1_RPC_URL` 등)로부터 첫 부팅 시 자동 생성

2. **Auto-Detection (두 가지 경로)**

**경로 A — 랜딩 마법사 (클라이언트 사이드, SentinAI 백엔드 없음)**
- 브라우저에서 직접 RPC URL로 fetch probe
- SentinAI 컨테이너 실행 전에 동작 → 백엔드 API 호출 불가
- 결과: 환경변수 블록 생성에만 사용 (등록 없음)

**경로 B — SentinAI 내부 (컨테이너 기동 후)**
- 입력: 환경변수에서 읽은 RPC/Beacon URL
- 출력: `clientFamily`, `clientVersion`, `chainId`, `syncMode`, `detectedCapabilities`
- 최소 감지 경로:
  - EL: `web3_clientVersion`, `eth_chainId`, `eth_syncing`, `admin_peers`(가능 시)
  - CL: `/eth/v1/node/version`, `/eth/v1/node/syncing`, `/eth/v1/node/peer_count`

3. **Capability Mapper**
- 감지 결과를 `ProtocolDescriptor.capabilities`로 매핑
- 예: `supportsTxPool`, `supportsPeerCount`, `supportsValidatorDuty`, `supportsAutoRemediation`
- 미지원 기능은 대시보드에서 자동 비활성화 (사용자 확인 불필요)

4. **Policy + Safety Binding**
- 인스턴스 생성 시 기본 정책 자동 부여: `observe-only`
- 승격 경로: `plan-only` → `execute-with-approval` → `full-auto`
- 모든 write 액션은 `operationId`, post-verify, rollback hook 필수

5. **API v2 (SentinAI 내부 API, 사용자 대시보드에서 호출)**
- `POST /api/v2/instances` — 환경변수 기반 인스턴스 자동 생성 (첫 부팅 시)
- `POST /api/v2/instances/{id}/validate` — RPC 연결 상태 재검증
- `GET /api/v2/instances/{id}/capabilities` — 감지된 기능 목록 조회
- `PATCH /api/v2/instances/{id}/policy` — 자율화 수준 승격
- `POST /api/v2/instances/{id}/bootstrap` — 에이전트 연결 + 대시보드 카드 초기화

6. **First-Run Bootstrap (대시보드 최초 접속 시 자동 처리)**
- `POST /api/v2/onboarding/complete` — SentinAI 내부에서 자동 호출
  - 처리: `detect → register → validate → capabilities → bootstrap`
  - 응답:
    - `instanceId`
    - `dashboardUrl`: `/dashboard` (상대 경로, 사용자 서버 기준)
    - `detectedClient`, `detectedCapabilities`
    - `nextActions` (정책 승격 필요 항목 안내)
- 이미 등록된 경우 멱등 처리 (재실행 안전)

## 3.2 Frontend (Landing)

1. **Connect 설정 생성기 (단일 페이지, 단계 없음)**

> **단계 제거 이유**: 브라우저에서 Ethereum RPC로 직접 fetch를 보내면 대부분의 노드에서 CORS로 차단된다.
> 연결 테스트와 자동 감지를 마법사에 넣어도 신뢰할 수 없어 UX만 복잡해진다.
> 감지는 SentinAI 컨테이너 첫 부팅 시 내부에서 처리한다.

- 노드 타입 드롭다운 (L1 EL / L1 CL / L2) + RPC URL 입력 필드
- [설정 생성] 클릭 → 클라이언트 사이드에서 즉시 `docker run` 명령어 + `.env.local` 렌더링
- 노드 타입별로 삽입되는 환경변수 키가 다름 (L2: `L2_RPC_URL`, CL: `CL_BEACON_URL` 등)
- API 호출 없음, 연결 테스트 없음

2. **Auto-Customized UX (SentinAI 내부)**
- 클라이언트 감지 + capability 매핑은 컨테이너 첫 부팅 시 자동 처리
- 감지된 capability에 따라 대시보드 카드/액션 자동 구성
- 미지원 기능은 자동 비활성화 (사용자 확인 불필요)

3. **First-Run Bootstrap (SentinAI 내부)**
- 사용자가 docker run 후 대시보드 최초 접속 시 자동 처리
- `POST /api/v2/onboarding/complete` (내부 호출) → 인스턴스 카드 생성
- 초기 상태: connectivity, health, last cycle, pending actions

## 3.3 Ownership Model (Self-Hosted First)

1. **배포 모델 전환**
- 기본값을 SaaS central-only가 아닌 self-hosted 우선 모델로 설계
- 사용자 인프라(로컬/VM/K8s)에 SentinAI control plane + dashboard 배포 가능해야 함

2. **데이터/비밀 소유권**
- 메트릭, 이벤트, 실행 로그, 인증 비밀은 사용자 스토리지에 저장
- 중앙 서버 텔레메트리는 opt-in으로 제한

3. **비용 책임 경계**
- 서비스 제공자가 부담: 제품 배포 아티팩트, 업그레이드 도구, 문서/지원
- 사용자(운영자)가 부담: 호스팅, 저장소, 트래픽, 모니터링, 알림 채널 실행비

4. **보안 경계**
- 기본 정책 `observe-only`
- write 권한은 명시적 승인 + 로컬 정책 승격 후에만 허용
- 인스턴스별 감사로그와 접근 제어를 테넌트 경계로 고정

## 3.4 Self-Hosted Tier 모델 (Honor System)

> **왜 기술적 강제를 하지 않나**: SentinAI는 self-hosted이며 사용자가 서버 코드와 LLM API 키를
> 모두 보유한다. 라이선스 토큰, feature gate throw 등 모든 기술적 차단은 코드 한 줄 수정으로
> 우회 가능하다. 실질적 가치는 **맞춤 설정 서비스와 팀 동행**이며, 이는 계약으로 보호된다.

1. **티어 정의**

| 티어 | 가격 | 내용 |
|------|------|------|
| General | 무료 | self-hosted, 모든 기능 사용 가능, 커뮤니티 지원 (GitHub Issues) |
| Premium | $299/체인/월 | 맞춤 설정 + 팀 동행 (90일 무료 체험) |
| Enterprise | 협의 | 전담 엔지니어, 커스텀 개발, NDA, 다중 체인 할인 |

**Premium 상세 내용:**
- **[맞춤 설정]** 커스텀 플레이북 작성 — 운영 환경에 맞는 자동화 시나리오 SentinAI 팀이 직접 제작
- **[맞춤 설정]** 이상 탐지 임계값 튜닝 — 실제 노드 패턴 기반으로 오탐/미탐 최소화
- **[팀 동행]** 전용 Slack 채널 — SentinAI 엔지니어가 직접 대응
- **[팀 동행]** 인시던트 co-response — 크리티컬 알림 발생 시 팀이 함께 참여
- **[팀 동행]** 월 1회 운영 리뷰 — 이상 패턴 분석 + 개선 제안
- **[우선 접근]** 신규 프로토콜 우선 지원 — 새 L2 체인, 새 CL 클라이언트 대응

> **ROI 근거**: 크리티컬 인시던트 1회 수동 대응 = 엔지니어 4~8시간. 월 1회만 막아도 $299 이상 절약.

2. **Feature Gate 구현 방식**
- `checkGate(feature)` → `{ included: boolean, nudgeMessage?: string }`
- Premium 기능 사용 시 **강제(throw) 없음** — 콘솔 로그 + 대시보드 토스트로 안내만
- UI에서 Premium 기능에 배지 표시 ("Premium에서 지원됩니다")

3. **체험 기간**
- `SENTINAI_TRIAL_ENDS_AT` 환경변수로 종료일 표시 (강제 차단 없음)
- 종료 7일 전부터 대시보드 배너 + 알림으로 안내
- 종료 후에도 계속 동작 — 계약 갱신은 운영자 책임

4. **가시성**
- `/api/subscription/status` → 현재 tier, 체험 종료일, Premium 기능 목록 반환
- 목적: 업그레이드 안내 UI를 위한 정보 제공 (강제 아님)

5. **환경변수**
- `SENTINAI_TRIAL_ENDS_AT`: 체험 종료일 (ISO 8601)
- `SENTINAI_TIER`: `general` | `premium` | `enterprise` (기본: `general`)
- `SENTINAI_SLACK_CHANNEL_URL`: Premium 전용 Slack 채널 Webhook URL

---

## 4) 4-Week Execution Plan

### Week 1: Data Model + Detection API

1. `NodeInstance`/`DetectedCapabilities` 타입 및 저장소 구현
2. `POST /api/v2/instances/validate` 구현 (EL/CL/L2 공통)
3. 감지 결과 표준 응답 스키마 확정
4. 단위테스트: 감지 성공/인증 실패/타임아웃/부분지원 케이스
5. `POST /api/v2/onboarding/complete` 초안 구현 (동기 등록 + URL 반환)

### Week 2: Capability Mapper + Policy Binding

1. ProtocolDescriptor 매핑 모듈 구현
2. 인스턴스 생성 시 기본 정책 자동 적용
3. operation safety chain 연결 (approval/verify/rollback)
4. API 통합테스트: create -> validate -> capability -> bootstrap
5. onboarding complete 통합테스트: complete -> dashboardUrl -> bootstrap status
6. `/api/subscription/status` + feature nudge 안내 구현 (강제 없음)

### Week 3: Connect Wizard + Dashboard Auto-Bootstrap

1. 랜딩 `/connect` 마법사 구현
2. validate 결과 기반 동적 폼/안내
3. 등록 완료 후 자동 대시보드 연동 + `dashboardUrl` 제공
4. e2e 테스트: L1 reth, L1 lighthouse, L2 op-stack 시나리오

### Week 4: Hardening + Docs + Rollout

1. 실패 복구/재시도/오류 메시지 정비
2. 보안 검토 (credential storage, mask, rotation path)
3. self-hosted 설치/업데이트/백업/복구 가이드 확정
4. staged rollout + success KPI 모니터링
5. 체험 종료일 안내 배너 + nudge 알림 동작 확인

---

## 5) Acceptance Criteria (DoD)

1. 로컬 또는 스테이징에서 `reth(EL) + beacon(CL)` 등록이 10분 내 완료된다.
2. 등록 직후 capability가 자동 반영된 대시보드 카드가 생성되고 `dashboardUrl`이 반환된다.
3. 기본 정책은 `observe-only`이며 승인 없이 write action이 실행되지 않는다.
4. 실패 시 사용자가 다음 조치를 알 수 있는 에러(인증/네트워크/권한)가 분리된다.
5. `npm run lint`, `npx tsc --noEmit`, `npm run test:run`, 핵심 e2e가 모두 통과한다.
6. self-hosted 모드에서 사용자 소유 스토리지/비밀 관리 구성이 문서와 설치 스크립트로 재현된다.
7. `/api/subscription/status`가 현재 tier와 체험 종료일을 반환하고, Premium 기능 사용 시 UI 안내 토스트가 표시된다.

---

## 6) Risks and Mitigations

1. Risk: 클라이언트별 RPC 편차로 감지 실패
- Mitigation: 다단 fallback probe + 부분 capability 모드 지원

2. Risk: 로컬 노드 보안 이슈 (과도한 권한)
- Mitigation: 기본 read-only + 명시적 policy 승격 + approval token

3. Risk: 온보딩 UX 복잡도 증가
- Mitigation: 3-step 고정 (확인 화면 제거) + 감지 결과 인라인 표시 + 실시간 가이드 메시지

4. Risk: 무료 사용자가 Premium 기능을 계속 사용
- Mitigation: 기술 강제 없음 (불가능). 실질적 가치인 기술 지원/SLA/팀 동행으로 유료 전환 유도

---

## 7) Out of Scope (이번 제안 제외)

1. 신규 결제/요금제 정책 변경
2. 완전 무인 write 실행의 기본값 활성화
3. 비EVM 체인에 대한 범용 자동 감지
