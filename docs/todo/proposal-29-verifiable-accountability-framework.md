# Proposal 29: Verifiable Accountability Framework

> 작성일: 2026-02-26  
> 상태: Draft (Phase 1 계획)

## 1) 배경

SentinAI는 이미 다음을 갖고 있다.
- 계획/실행/검증/롤백 API 분리
- 권한/승인 가드레일
- 감사 로그 및 Decision Trace
- 자율성 레벨(A0~A5) 정책

하지만 "시니어 DevOps 대체 수준"의 검증 가능한 책임 체계는 아직 부족하다.

## 2) 핵심 갭 (현재 부족점)

1. 변경 전/후 SLO 자동 판정 표준이 약함  
2. "왜 이 결정을 했는지" 정형 근거(Provenance) 저장이 불완전함  
3. 스택별/체인별 장기 책임 추적 대시보드가 없음  
4. 실패 원인 분류(정책 결함 vs 실행 결함)와 재학습 루프가 약함

## 3) 목표

`탐지 → 계획 → 실행 → 검증 → 롤백 → 책임 판정 → 정책 업데이트`를 단일 체계로 묶는다.

핵심 원칙:
- 모든 write-family 실행은 증빙 가능해야 한다.
- 검증 실패는 자동으로 원인 분류되어야 한다.
- 분류 결과는 정책/플레이북 개선으로 다시 반영되어야 한다.

## 4) 통합 아키텍처

### 4.1 구성 요소

1. **Evidence Collector**  
- 실행 전/후 스냅샷(메트릭, 이벤트, 정책, 체인 상태) 수집

2. **Preflight Simulator**  
- write 액션 전 dry-run + blast radius 평가

3. **Postcondition Verifier**  
- SLO/가드레일 기준으로 PASS/FAIL 판정

4. **Liability Classifier**  
- 실패 시 원인을 `policy_defect` / `execution_defect` / `infra_dependency` / `unknown`으로 분류

5. **Rollback Orchestrator**  
- 판정 실패 시 조건부 자동 롤백

6. **Policy Learner**  
- 분류 결과를 근거로 임계치/규칙/우선순위 제안 생성

7. **Audit Ledger**  
- 위 전 과정을 immutable event chain으로 저장

### 4.2 데이터 계약 (신규)

`src/types/accountability.ts`:
- `EvidenceBundle`
- `PreflightResult`
- `PostconditionResult`
- `LiabilityClassification`
- `AccountabilityRecord`
- `PolicyLearningSuggestion`

## 5) 구현 워크스트림

## WS-A: 검증 표준화 (SLO Gate)
- 파일:
  - `src/lib/operation-verifier.ts` 확장
  - `src/lib/accountability/slo-gate.ts` 신규
  - `src/app/api/autonomous/verify/route.ts` 응답 확장
- 구현:
  - write 액션별 필수 postcondition 템플릿 정의
  - SLO 판정(지연/에러율/블록 진행/복구 시간) 표준화
- DoD:
  - verify 응답에 `gateResults[]`와 `blockingIssues[]` 필수 포함
  - FAIL 시 machine-readable reason code 반환

## WS-B: 결정 근거(Provenance) 정형화
- 파일:
  - `src/types/agent-memory.ts` 확장
  - `src/lib/agent-memory.ts` 확장
  - `src/lib/goal-planner.ts`, `src/lib/agent-loop.ts` 주입
- 구현:
  - 의사결정 입력 신호, 정책 버전, 후보 점수, 선택 이유를 구조화 저장
- DoD:
  - 모든 dispatch/write 이벤트에 `reasonTraceId` 존재
  - trace 조회 API에서 policy version과 scoring evidence 확인 가능

## WS-C: 책임 분류 + 재학습 루프
- 파일:
  - `src/lib/accountability/classifier.ts` 신규
  - `src/lib/goal-learning.ts` 확장
  - `src/app/api/goal-manager/dispatch/route.ts`/`worker` 연결
- 구현:
  - verify 실패 케이스 자동 분류
  - 분류 결과로 정책 제안(임계치 조정, suppression 룰 조정) 생성
- DoD:
  - 실패 이벤트의 90% 이상에 분류 결과 기록
  - 제안 생성 API 제공 (`/api/accountability/learning-suggestions`)

## WS-D: 통합 대시보드
- 파일:
  - `src/app/page.tsx` (Autonomy Cockpit 확장)
  - `src/app/api/accountability/summary/route.ts` 신규
- 구현:
  - 최근 24h/7d 기준 PASS/FAIL, rollback rate, liability 분포 시각화
  - stack/chain 필터 지원
- DoD:
  - 운영자가 "누가/왜/무엇 때문에 실패했는지"를 1분 내 설명 가능

## WS-E: 감사 로그 내구성
- 파일:
  - `src/lib/ops-adapter/audit.ts` 확장
  - `src/lib/redis-store.ts` 또는 별도 append-only storage adapter
- 구현:
  - 감사 이벤트 해시 체인(이전 이벤트 해시 포함) 저장
  - tamper-evident 검증 유틸 제공
- DoD:
  - 랜덤 샘플 검증 시 위변조 탐지 가능

## 6) 단계별 일정 (권장 6주)

1. **Week 1**
- WS-A 기본 SLO gate + API 응답 확장

2. **Week 2**
- WS-B reason provenance 저장 경로 통합

3. **Week 3**
- WS-C 분류기 v1 + learning suggestion

4. **Week 4**
- WS-D Cockpit 책임 뷰 추가

5. **Week 5**
- WS-E tamper-evident audit chain

6. **Week 6**
- 통합 E2E + 운영 튜닝 + runbook 확정

## 7) KPI / 성과지표

1. verify 실패 중 원인 분류율: **>= 90%**  
2. write 액션의 reasonTrace 누락률: **<= 1%**  
3. rollback 후 SLO 회복 시간(MTTR): **20% 개선**  
4. 운영자 설명 가능 시간: **5분 → 1분 이내**

## 8) 리스크 및 대응

1. 분류기 오판  
- 대응: unknown 버킷 유지 + 수동 피드백 루프

2. 로그 저장 비용 증가  
- 대응: 핫/콜드 보존 정책 및 압축

3. 과도한 가드레일로 자동화 속도 저하  
- 대응: A레벨별 gate 강도 차등 적용

## 9) 즉시 착수 체크리스트

- [ ] `src/types/accountability.ts` 초안 작성
- [ ] verify 응답 스키마(`gateResults`, `blockingIssues`) 확장
- [ ] dispatch/write 경로에 `reasonTraceId` 필수화
- [ ] 실패 분류기 v1 rule set 구현
- [ ] Cockpit 책임 요약 카드(24h FAIL/rollback/liability) 추가
