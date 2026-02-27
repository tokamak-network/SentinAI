# SentinAI 방어 고도화 구현 계획
## 기준일: 2026-02-27

## 1. 목표
1. 기존 평가에서 `부분 가능/어려움`으로 남은 4개 영역을 자동 방어로 전환한다.
2. 범위: 클라이언트별 자동교정, OP Stack 시퀀서 HA(op-conductor), Arbitrum AnyTrust DAC 보호, ZK Prover 선제 스케일링.
3. 완료 기준: 탐지 → 조치 → 검증 → 롤백이 API/에이전트 루프/테스트에서 모두 증명된다.

## 2. 작업 스트림
1. Stream A: 클라이언트별 자동교정
2. Stream B: OP Stack HA(op-conductor)
3. Stream C: Arbitrum AnyTrust DAC 보호
4. Stream D: ZK Prover GPU/Spot 오토스케일
5. Stream E: 공통 품질 강화(탐지 정확도, 로그 패턴 매칭, 정책/감사/테스트)

## 3. 일정 (4주)
1. Week 1 (2026-02-27 ~ 2026-03-05): 설계, 타입 계약, 어댑터 골격
2. Week 2 (2026-03-06 ~ 2026-03-12): 자동 조치 구현 + 검증/롤백 경로
3. Week 3 (2026-03-13 ~ 2026-03-19): 시뮬레이션, E2E, 장애 주입 테스트
4. Week 4 (2026-03-20 ~ 2026-03-26): 카나리 배포, 운영 튜닝, 문서화

## 4. 상세 구현 항목

### Stream A. 클라이언트별 자동교정
1. `src/core/collectors`에 EL/CL 클라이언트 capability 감지 추가 (`geth`, `reth`, `nethermind`, `lighthouse`, `prysm`, `teku`).
2. `src/lib/client-remediation-engine.ts` 신규 구현.
3. 자동 조치 룰 구현:
   - `reth`: pruning 빈도 완화 정책 (안전 범위 내 설정 조정)
   - `teku`: JVM heap 권고/적용 경로
   - `lighthouse`: bootnodes/컨센서스 필수 설정 검증
   - `nethermind`: GC 지연 및 정지 징후 시 롤링 재시작
4. 모든 조치에 `dryRun`, `allowWrites`, `verification`, `rollback` 필수 적용.

### Stream B. OP Stack 시퀀서 HA(op-conductor)
1. `src/lib/op-conductor-operator.ts` 신규 구현.
2. `admin_startSequencer`/`admin_stopSequencer` 기반 active/standby 스위치 자동화.
3. sequencer drift 탐지 시 정책 기반 자동 failover 실행.
4. 대시보드에 active/standby 상태 및 마지막 전환 이벤트 노출.

### Stream C. Arbitrum AnyTrust DAC 보호
1. DAC 헬스 지표 수집기 추가 (`signLatency`, `signSuccessRate`, `queueDepth`).
2. 임계치 초과 시 단계별 조치:
   - route degrade
   - sequencer scale-up
   - operator escalation
3. RaaS 의존성 장애 시 수동 개입 포인트/런북 명확화.

### Stream D. ZK Prover 선제 스케일링
1. 메트릭 파이프라인 추가 (`proofQueueDepth`, `proofGenLatency`, `gpuUtilization`).
2. 5~10분 선행 예측 기반 scale-out 정책 구현.
3. GPU/Spot 노드풀 선택 로직 + 실패 시 on-demand fallback.
4. scale-in/out cooldown 및 월 비용 상한 정책 적용.

### Stream E. 공통 품질 강화
1. `playbook-matcher`의 `log_pattern` TODO 제거 및 실제 로그 매칭 연결.
2. 메트릭+로그 복합 조건(AND/OR) 판정 정확도 개선.
3. 감사 로그 표준화 (`who`, `why`, `before`, `after`, `verification`, `rollbackId`).
4. 테스트 확장:
   - unit
   - integration
   - E2E
   - chaos/fault injection (429, timeout, OOM, drift, DAC 지연)

## 5. 산출물
1. 신규 모듈 4종:
   - `client-remediation-engine`
   - `op-conductor-operator`
   - `dac-monitor`
   - `prover-autoscaler`
2. API 엔드포인트 4종 (`status`, `plan`, `execute`, `rollback`).
3. 대시보드 카드 3종 (Sequencer HA, DAC Health, Prover Capacity).
4. 테스트 스위트 확장 + 운영 런북 + 환경변수 가이드.

## 6. 수용 기준 (Acceptance Criteria)
1. 12개 대표 장애 시나리오 재현 시 자동 탐지율 95% 이상.
2. 자동 조치 성공률 85% 이상.
3. 실패 시 롤백 성공률 100%.
4. 오탐으로 인한 불필요한 자동 실행 월 1회 이하.
5. 검증 커맨드 통과:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm run test:run`

## 7. 즉시 시작 순서
1. Week 1 설계 브랜치 생성 후 타입 계약 확정.
2. 공통 기반인 `log_pattern` 실매칭과 테스트 우선 완료.
3. Stream B(op-conductor)와 Stream D(prover) 병렬 착수.
4. Week 2 말 카나리 환경에서 장애 주입 리허설 실행.

## 8. 리스크 및 대응
1. 클라이언트별 설정 자동 변경 리스크
   - 대응: 기본 `dryRun`, 승인 정책, 자동 롤백.
2. Spot 인스턴스 변동성
   - 대응: 온디맨드 fallback + 예산 상한.
3. 외부 의존성(DAC/RaaS/API) 가용성
   - 대응: degrade 모드 + 경보 + 수동 runbook.
