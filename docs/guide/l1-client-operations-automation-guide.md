# L1 클라이언트 운영 자동화 기술 요소 가이드

## 1. 목적과 성공 기준

- 반복적인 L1 운영 업무를 자동화해 MTTA, MTTR, SLA 준수율을 개선한다.
- 자동화 범위는 `접수 -> 분류 -> 조치 -> 검증 -> 에스컬레이션 -> 회고`의 전체 운영 루프를 포함한다.

권장 KPI:
- MTTA 30% 이상 단축
- MTTR 20% 이상 단축
- L1 자동 처리율 40% 이상
- 잘못된 자동 조치 실행률 1% 이하

## 2. 적용 범위

- 채널: 모니터링 알림, 이메일/채팅, ITSM 티켓
- 대상: 표준화 가능한 L1 업무(기본 진단, 런북 실행, 티켓 상태 동기화)
- 제외: 데이터 파괴 가능 작업, 규제 승인 필수 작업, 고위험 인프라 변경

## 3. 기준 아키텍처

```text
[Event Ingestion] -> [Normalization] -> [Classifier/Priority]
 -> [Workflow Orchestrator] -> [Runbook Executor]
 -> [Verification] -> [ITSM Sync + Escalation]
 -> [Observability/Audit + Knowledge Base]
```

## 4. 필수 기술 요소 (DoD 포함)

| # | 영역 | 필요한 기술 요소 | 최소 구현 기준 (DoD) | 핵심 지표 |
|---|---|---|---|---|
| 1 | 이벤트 수집/정규화 | API/Webhook/Polling 수집, 공통 스키마 정규화 | 3개 이상 채널 연동, 스키마 버전 관리, 재처리 가능한 큐 확보 | 수집 성공률, 이벤트 유실률, 수집 지연 |
| 2 | 분류/우선순위 | 룰 + ML/LLM 기반 분류, 심각도/우선순위 산정 | confidence score 제공, SLA 우선순위 자동 부여, 수동 재분류 경로 제공 | 분류 정확도, 오분류율, SLA 위반 예측 정확도 |
| 3 | 워크플로 오케스트레이션 | 상태 머신 기반 처리 흐름, 재시도/타임아웃 제어 | 멱등성 키, 재시도 정책, 실패 상태 추적(`failed`, `manual_required`) | 워크플로 완료율, 재시도 성공률 |
| 4 | 런북 자동 실행 | 플레이북/스크립트 실행 엔진, 승인 게이트 | Dry-run, 롤백 절차, 실행 전/후 검증 단계 포함 | 자동 조치 성공률, 롤백률 |
| 5 | ITSM/CRM 연동 | 티켓 생성/상태/코멘트 양방향 동기화 | 티켓 상태 양방향 동기화, 중복 생성 방지 키, 실패 재동기화 큐 | 티켓 동기화 지연, 중복 티켓 발생률 |
| 6 | 에스컬레이션 정책 | SLA 타이머, 신뢰도 임계치 기반 이관 | 신뢰도/실패 횟수/SLA 임박 기준 자동 이관, 담당자 라우팅 | 에스컬레이션 리드타임, 오에스컬레이션율 |
| 7 | 지식베이스/RAG | 런북, FAQ, 과거 티켓 검색/추천 | 문서 버전 관리, 답변 근거 링크 제공, 미해결 케이스 피드백 루프 | 1차 해결률(FCR), 추천 답변 채택률 |
| 8 | 관측성/감사 | 로그/메트릭/트레이스, 자동화 의사결정 감사로그 | 실행 경로 추적 가능, 실패 원인 코드 표준화, 대시보드 가시화 | MTTA, MTTR, 자동화 성공률 |
| 9 | 보안/컴플라이언스 | RBAC, 비밀정보 관리, PII 보호 | 최소권한 권한모델, 감사로그 보존, 비밀정보 마스킹/암호화 | 권한 위반 차단율, 감사 추적 완결성 |
| 10 | 안정성/복구 | 큐 기반 비동기 처리, 서킷브레이커, 수동 전환 | 백오프 재시도, 실패 시 수동 처리 전환(`human_fallback`) 보장 | 장애 시 복구 시간, 자동화 중단 시간 |
| 11 | 검증/배포 | 샌드박스 테스트, 카나리 배포, 버전 롤백 | 룰/프롬프트 버전 고정, 배포 승인 게이트, 즉시 롤백 가능 | 배포 후 장애율, 사전 검증 적발률 |
| 12 | 운영 거버넌스 | RACI, 승인 정책, 변경관리 체계 | 자동화 허용 범위 명문화, 고위험 작업 승인 경로, 정기 운영 리뷰 | 정책 위반 건수, 변경 실패율 |

## 5. 프로젝트 분석 요약 (2026-02-22 기준)

| 클라이언트 | 분석 스냅샷 | 운영 관점 핵심 사실 | 문서 반영 자동화 포인트 |
|---|---|---|---|
| reth | `v1.11.0` (2026-02-12) | 릴리즈가 빠르고, `storage.v2` 전환 시 기존 DB 호환 이슈로 재동기화가 필요할 수 있다. OTLP tracing 설정이 노출되어 있다. | 버전 감지+카나리, 스토리지 포맷 변경 감지, 재동기화 런북 자동 호출 |
| besu | `v26.1.0` (2026-02-16) | Bonsai/Forest 저장소 선택에 따라 운영 특성이 달라진다. Prometheus/OpenTelemetry 모니터링 경로가 공식 제공된다. 일부 history pruning 플래그는 deprecated 흐름이 있다. | 저장소 모드별 용량 정책, JVM/GC 가드, deprecated 플래그 검사 자동화 |
| erigon | `v3.3.8` (2026-02-11) | 성능 지향 구조와 함께 NVMe SSD 권장, 컴포넌트 분리(`rpcdaemon` 등) 운영 패턴이 강하다. | NVMe/IOPS 임계치 기반 사전조치, 프로세스별 헬스체크, 컴포넌트 단위 재기동 런북 |
| ethrex | `v9.0.0` (2026-01-13) | L1/L2 경량 구현 지향이며, 최근 릴리즈에서 JWT 자동 생성/메트릭 엔드포인트 변경 등 운영면 변화가 확인된다. | 그림자 트래픽 우선, 메트릭 포트 자동 탐지, JWT 상태 자동 검증 |
| nethermind | `v1.36.0` (2026-02-12) | Health Check(Webhook 포함), `admin_prune` 및 hybrid/full pruning 모드 등 운영 제어면이 명시적이다. | health webhook -> 자동 티켓, 스토리지 임계치 기반 사전 대응, pruning 작업 창 관리 |

분석 근거:
- reth: [Releases](https://github.com/paradigmxyz/reth/releases), [Prune docs](https://reth.rs/cli/reth/node/builder/pruning/), [Run docs](https://reth.rs/run/mainnet/)
- besu: [Releases](https://github.com/hyperledger/besu/releases), [Data storage formats](https://besu.hyperledger.org/public-networks/concepts/data-storage-formats), [Monitor nodes](https://besu.hyperledger.org/public-networks/how-to/monitor/monitor-nodes), [History pruning](https://besu.hyperledger.org/public-networks/concepts/history-pruning)
- erigon: [Releases](https://github.com/erigontech/erigon/releases), [Docs home](https://docs.erigon.tech/), [Hardware requirements](https://docs.erigon.tech/getting-started/hw-requirements)
- ethrex: [Releases](https://github.com/lambdaclass/ethrex/releases), [Docs home](https://docs.ethrex.xyz/)
- nethermind: [Releases](https://github.com/NethermindEth/nethermind/releases), [Health checks](https://docs.nethermind.io/next/fundamentals/configuration/health-checks/), [Pruning](https://docs.nethermind.io/next/fundamentals/pruning/)

## 6. 분석 결과 기반 비-geth 클라이언트 자동화 요소 (DoD 포함)

| # | 전용 자동화 항목 | 분석 기반 이유 | 최소 구현 기준 (DoD) |
|---|---|---|---|
| 1 | 비-geth 클라이언트 풀 다변화 | 단일 구현체 결함 전파를 차단해야 한다 | `reth/besu/erigon/ethrex/nethermind` 중 2개 이상 상시 운영, 불일치 시 자동 격리/우회 |
| 2 | 릴리즈 인텔리전스 파이프라인 | 5개 프로젝트 모두 릴리즈 변화가 빈번하다 | GitHub 릴리즈 감시 -> 영향 분석 -> 카나리 -> 단계 배포 -> 자동 롤백 |
| 3 | JSON-RPC 계약 테스트 게이트 | 클라이언트별 RPC/trace 동작 편차가 발생한다 | `eth_*`, `debug_*`, `trace_*`, Engine API 계약 테스트 실패 시 배포 차단 |
| 4 | 동기화/최종성 지연 감시 | 공통 장애 신호를 먼저 포착해야 한다 | `eth_syncing`, `eth_blockNumber`, finalized/safe lag 임계치 및 자동 티켓 발행 |
| 5 | 클라이언트 간 정합성 교차검증 | 조용한 불일치는 사후 대응이 어렵다 | 동일 높이 `block hash`, `receipt root`, trace 샘플 비교와 편차 감지 자동화 |
| 6 | 스토리지 모드 인지 운영 자동화 | Besu(Bonsai/Forest), Nethermind(pruning mode), Reth(storage format)별 정책이 다르다 | 모드별 임계치/작업창 분리, 포맷 전환 탐지 시 재동기화 runbook 강제 |
| 7 | 디스크/IO 집중 가드 | Erigon 계열은 IOPS 병목 리스크가 크다 | NVMe/IOPS/latency 임계치 경보, 사전 증설 또는 compaction/prune 자동 실행 |
| 8 | JVM 런타임 가드 | Besu는 JVM 상태가 직접 장애로 이어질 수 있다 | heap/GC pause SLO, OOM 선제 알람, 튜닝/재기동 플레이북 자동 연결 |
| 9 | Health webhook 연동 | Nethermind health signal은 자동화 입력으로 유용하다 | health 상태 변화를 webhook으로 수집해 티켓/에스컬레이션에 즉시 반영 |
| 10 | EL-CL 연계 보전 | JWT/endpoint 단절은 블록 진행 중단으로 이어진다 | JWT/endpoint 헬스체크, 실패 시 재연결 및 프로세스 복구 자동화 |
| 11 | 메트릭 엔드포인트 동적 탐지 | Ethrex 등 릴리즈에서 메트릭 포트/형식이 변할 수 있다 | 클라이언트별 메트릭 엔드포인트 discovery + 스크레이프 실패 자동 수정 |
| 12 | 그림자 트래픽/카나리 승격 | 성숙도 차이가 있는 클라이언트는 단계 배포가 필요하다 | 신규 버전은 그림자 트래픽으로 검증 후 SLO 충족 시 점진 승격 |
| 13 | 고위험 작업 승인 게이트 | 재동기화/pruning/업그레이드는 서비스 영향이 크다 | 2단계 승인 + 실행 전후 검증 + 자동 롤백 체크포인트 강제 |
| 14 | Deprecated 설정 탐지 | Besu 등은 릴리즈에서 설정 변경/삭제가 발생한다 | 배포 전 설정 lint로 deprecated/removed 플래그 차단 |

### 6.1 클라이언트별 운영 포인트 (분석 반영)

| 클라이언트 | 운영 특성 | 필수 자동화 포인트 |
|---|---|---|
| reth | 빠른 릴리즈 주기, 스토리지 전환 이슈 가능 | 릴리즈 감시, storage-format drift 탐지, 재동기화 자동 런북 |
| besu | JVM + 저장소 모드(Bonsai/Forest) 영향 큼 | heap/GC 가드, 저장소 모드별 용량/성능 정책, deprecated 옵션 lint |
| erigon | NVMe/IO 성능 의존 + 컴포넌트 분리 운영 | 디스크/IOPS 가드, 컴포넌트별 헬스체크, 프로세스 단위 복구 |
| ethrex | 경량 지향 + 운영면 변경 가능성 존재 | 그림자 트래픽, 메트릭 포트 동적 탐지, JWT 상태 자동 검증 |
| nethermind | health/pruning 제어면이 풍부 | webhook 기반 자동 티켓, pruning 모드 기반 정책, 저용량 임계치 사전 대응 |

## 7. MVP 우선순위 (4주)

1. 주 1-2: `릴리즈 감시 + 계약 테스트 게이트 + 동기화/정합성 감시`
- 목표: 배포 전 회귀 차단과 런타임 정합성 이상 탐지 자동화
2. 주 3: `스토리지/디스크/JVM/health-webhook 특화 가드`
- 목표: 클라이언트별 리소스/헬스 리스크를 자동 완화
3. 주 4: `카나리 승격 + 고위험 승인 게이트 + 복구 훈련`
- 목표: 업그레이드/재동기화 작업을 운영 승인 가능한 통제 수준으로 고정

## 8. 운영 시작 체크리스트

- `reth/besu/erigon/ethrex/nethermind` 중 최소 2개 구현체를 운영 풀에 포함했는가?
- 배포 전 JSON-RPC/Engine API 계약 테스트가 자동 실행되고 실패 시 차단되는가?
- 릴리즈 파이프라인이 `감지 -> 영향 분석 -> 카나리 -> 단계 배포 -> 롤백`으로 자동화되어 있는가?
- finalized/safe 지연과 클라이언트 간 해시 편차를 상시 감시하는가?
- 디스크/IO/JVM/health webhook을 클라이언트별로 분리된 임계치로 운영하는가?
- 런북/오케스트레이터가 단일 클라이언트 전용 플래그에 의존하지 않는가?

## 9. L1 운영 이슈와 해결 방안 매트릭스

| 우선순위 | 운영 이슈 | 탐지 신호 | 즉시 대응 | 근본 해결/자동화 |
|---|---|---|---|---|
| P1 | 동기화 지연/정지 | `eth_syncing=true` 장기 지속, head lag 증가 | 문제 노드를 read pool에서 제외, healthy 노드로 트래픽 우회 | lag 임계치 기반 자동 격리, 자동 재기동/재동기화 runbook |
| P1 | EL-CL 연결 단절 | Engine API 실패, JWT 인증 실패, 블록 생성 정지 | EL/CL 연결 상태 점검, JWT 파일/권한/경로 확인 후 재연결 | JWT 만료/경로 검증 자동화, EL-CL 헬스체크 기반 self-heal |
| P1 | 체인 분기/정합성 불일치 | 동일 높이 `block hash` 편차, reorg 급증 | 편차 노드 즉시 격리, 기준 노드 재검증 | 다중 클라이언트 교차검증 자동화, 편차 발생 시 자동 티켓+에스컬레이션 |
| P1 | RPC 장애(고지연/5xx 급증) | p95/p99 지연 급상승, 5xx 비율 상승 | rate-limit 강화, write/read 분리, 장애 노드 트래픽 차단 | 메서드별 SLO + circuit-breaker + adaptive load balancing |
| P1 | 디스크 고갈/IO 병목 | 디스크 사용률/IO wait 급증, compaction 지연 | 긴급 용량 확장 또는 불필요 데이터 정리, 고부하 작업 중지 | 저장소 모드별 용량 정책, pruning/compaction 자동 스케줄 |
| P1 | DB 손상/부팅 실패 | 노드 반복 재시작, DB 관련 fatal 로그 | 스냅샷 복구 또는 재동기화, 장애 노드 서비스 제외 | 정기 스냅샷/복구 드릴, 부팅 실패 패턴 자동 분류 및 대응 |
| P2 | 피어 급감/편중 | 피어 수 급락, 지역/ASN 편중 심화 | peer 재탐색, 네트워크 재초기화 | 피어 품질 점수화, 임계치 기반 bootstrap peer 자동 재구성 |
| P2 | JVM 메모리/GC 압박(Besu) | GC pause 증가, heap 사용률 고점 유지 | JVM 튜닝 적용, 필요 시 점진 재시작 | heap/GC SLO 가드, OOM 선제 경고 및 자동 조치 |
| P2 | txpool 정체/nonce gap | pending tx 급증, dropped/replaced 비율 상승 | 문제 계정/가스 정책 진단, RPC write 경로 보호 | txpool 지표 기반 이상탐지 및 자동 진단 리포트 생성 |
| P2 | 업그레이드 회귀/호환성 실패 | 배포 직후 에러율 증가, API 계약 테스트 실패 | 롤백, 카나리 트래픽 축소 | 릴리즈 영향분석 + 계약 테스트 게이트 + 단계적 승격 파이프라인 |
| P2 | 설정 드리프트/Deprecated 플래그 사용 | 노드별 설정 fingerprint 불일치, 시작 경고 로그 | 변경 노드 격리, 표준 설정 재배포 | 선언형 설정 관리(IaC), 배포 전 설정 lint 및 deprecated 차단 |
| P3 | 모니터링 공백/알람 누락 | 메트릭 수집 단절, 알람 미발행 | 관측 경로 복구, 수동 점검 모드 전환 | 메트릭 endpoint discovery, 알람 루트 이중화 및 heartbeat 체크 |

### 9.1 이슈 대응 표준 흐름

1. `탐지`: 임계치/패턴 기반으로 이슈를 분류(P1/P2/P3)한다.
2. `격리`: 사용자 영향이 있는 노드를 우선 트래픽에서 분리한다.
3. `복구`: 자동 runbook 또는 승인된 수동 조치로 상태를 회복한다.
4. `검증`: `head/finalized`, RPC SLO, 정합성 지표 복구를 확인한다.
5. `회고`: 원인/조치/재발방지 규칙을 문서와 정책 엔진에 반영한다.

### 9.2 완전 자동화 가능 이슈별 AI Agent 복구 액션

| 이슈 | AI Agent 액션 시퀀스 (무인) | 필요 권한 | 안전 가드레일 |
|---|---|---|---|
| 동기화 지연/정지 | `lag 감지 -> read pool 제외 -> 노드 재시작 -> sync 상태 재검증 -> pool 재편입` | 서비스 오케스트레이터 권한 | `max_restart_per_hour`, 2회 연속 실패 시 자동 중단/에스컬레이션 |
| EL-CL 연결 단절 | `JWT/endpoint 진단 -> EL 재연결 -> CL 재연결 -> 엔진 API 정상성 검증` | 서비스/파일 읽기 권한 | JWT 파일 변경 금지, 경로/권한 검증 실패 시 수동 전환 |
| RPC 장애(고지연/5xx) | `메서드별 rate-limit 조정 -> 장애 노드 drain -> healthy 노드로 라우팅 -> SLO 복구 확인` | LB/API 게이트웨이 정책 권한 | 변경 TTL(예: 10분), SLO 미복구 시 자동 롤백 |
| 피어 급감/편중 | `피어 품질 진단 -> bootnode refresh -> P2P 재기동 -> 필요 시 inbound 30303 임시 차단` | 네트워크 제어 권한(`sudo` 포함 가능) | 포트 차단은 `TTL 기반 임시 규칙`만 허용, 만료 시 자동 원복 |
| JVM 메모리/GC 압박(Besu) | `heap/GC 임계치 초과 감지 -> 제한적 재시작/튜닝 profile 적용 -> GC 정상화 검증` | 서비스 재기동 권한 | 튜닝 프로필 allowlist 고정, 비허용 플래그 적용 차단 |
| 모니터링 공백/알람 누락 | `scrape 대상 재발견 -> collector 재기동 -> heartbeat 회복 검증` | 모니터링 스택 권한 | 수집 경로 변경은 등록된 endpoint 패턴 내에서만 허용 |

포인트:
- 완전 자동화는 `복구 가능(reversible)`하고 `영향 반경이 제한된` 액션만 허용한다.
- 동일 액션 반복 실패 시 자동 중단하고 L2/L3로 즉시 이관한다.

## 10. `sudo` 포함 고권한 액션을 안전하게 자동화하는 모델 (OpenClaw 유사)

결론:
- 가능하다. 다만 AI Agent에 `범용 root 권한`을 주면 안 되고, `정책 기반 Action Broker`를 통해서만 실행해야 한다.

권장 구조:
1. `Policy Engine`: 이슈 타입, 신뢰도, 영향도, 현재 상태를 평가해 실행 가능 여부를 판정
2. `Action Broker`: 승인된 runbook ID만 실행하고, 파라미터 범위를 검증
3. `Privileged Wrapper`: `sudo`는 개별 스크립트 래퍼에만 위임(`iptables`/`nft` 직접 호출 금지)
4. `Post-Verification`: 조치 후 성공 조건(`peer count`, `RPC SLO`, `head lag`) 검증
5. `Auto-Rollback`: TTL 만료 또는 검증 실패 시 자동 원복
6. `Audit`: 누가/언제/왜/무슨 파라미터로 실행했는지 변경 불가능 로그 저장

### 10.1 피어 급감 시 30303 제어 예시

- 목적: 악성 inbound 또는 비정상 트래픽으로 피어 품질이 급락할 때 단기적으로 보호
- 권장 실행 방식 1: AI Agent는 `network_guard.apply_temporary_drop(port=30303, ttl=300)` 같은 추상 액션만 호출
- 권장 실행 방식 2: Broker가 허용 정책 확인 후 `sudo /usr/local/bin/sentinai-net-guard --drop-inbound 30303 --ttl 300` 실행
- 권장 실행 방식 3: TTL 만료 시 자동 해제, 중간에 지표 복구되면 조기 해제
- 필수 제약 1: 포트/TTL 범위 고정(`port in {30303}`, `ttl <= 600`)
- 필수 제약 2: 동시 차단 규칙 수 제한
- 필수 제약 3: 실행 전후 `peer_count`, `inbound_conn_error_rate`, `block_propagation_latency` 검증
- 필수 제약 4: 실패 시 즉시 원복 + 에스컬레이션
