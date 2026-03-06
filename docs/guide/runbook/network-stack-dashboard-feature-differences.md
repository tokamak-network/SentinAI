# 네트워크 스택별 대시보드/기능 차이 가이드 (Thanos / OP Stack / Arbitrum Orbit / ZK Stack)

기준일: 2026-02-24

이 문서는 SentinAI가 다중 네트워크 스택을 지원할 때,
운영자가 대시보드에서 어떤 차이를 기대해야 하는지와 자율 운영 기능 차이를 정리한다.

## 1. 핵심 원칙

1. 대시보드 레이아웃은 공통이다.
- 동일한 메인 UI(`Metrics`, `Agent Loop`, `Autonomy Cockpit`)를 사용한다.

2. 표시되는 카드/세부 필드는 체인 플러그인 capability로 달라진다.
- 기준: `ChainPlugin.capabilities`
- 예: `proofMonitoring`, `settlementMonitoring`, `disputeGameMonitoring`

3. 자율 운영 버튼은 공통이지만 내부 step/action은 체인 어댑터가 결정한다.
- 기준: chain adapter(`opstack`, `arbitrum`, `zkstack`)

## 2. 스택별 차이 요약

| 스택 | Primary Execution | 주요 운영 컴포넌트 | 대시보드 카드 특성 | 자율 운영 대표 액션 |
|---|---|---|---|---|
| Thanos | `op-geth` | `op-node`, `op-batcher`, `op-proposer`, `op-challenger` | OP 계열 카드 기본 노출 | `scale_execution`, `restart_proposer`, `switch_l1_rpc` |
| OP Stack (Optimism) | `op-geth` | `op-node`, `op-batcher`, `op-proposer`, `op-challenger` | Thanos와 거의 동일 | `scale_execution`, `restart_batcher`, `restart_proposer` |
| Arbitrum Orbit | `nitro-node` | `batch-poster`, `validator` | 분쟁/증명/정산 카드 기본 비중 낮음 | `scale_sequencer`, `restart_batch_poster`, `restart_validator` |
| ZK Stack | `zksync-server` | `zk-prover`, `zk-batcher` | `proof/settlement` 카드가 probe 설정에 따라 동적 노출 | `scale_core_execution`, `restart_prover`, `restart_batcher_pipeline` |

## 3. 대시보드에서 실제로 보이는 차이

### 3.1 Metrics/Components 해석 대상

- Thanos/OP Stack:
  - 실행/합의/배처/프로포저/챌린저 중심
- Arbitrum Orbit:
  - Nitro 노드 + 배치 포스터 + 검증자 중심
- ZK Stack:
  - ZK core + prover + settlement pipeline 중심

### 3.2 capability 기반 카드 노출

- 공통 활성(대부분):
  - `l1Failover`
  - `eoaBalanceMonitoring`
- OP 계열 중심:
  - `disputeGameMonitoring`
- ZK 계열에서 특히 중요:
  - `proofMonitoring`
  - `settlementMonitoring`
  - 단, ZK는 probe 설정 여부에 따라 동적으로 활성화될 수 있다.

### 3.3 Autonomy Cockpit 버튼의 의미 차이

Autonomy Cockpit의 `Plan/Execute/Verify/Rollback` 및 기존 Demo 버튼은 공통이다.
하지만 같은 intent라도 체인별 실행 step이 다르다.

예시: `recover_sequencer_path`
- OP Stack/Thanos: sequencer path + proposer/batcher 복구 중심
- Orbit: batch poster / validator 복구 중심
- ZK Stack: prover / batcher pipeline 복구 중심

## 4. 운영자가 확인해야 할 포인트

1. 현재 체인 타입 확인
- `CHAIN_TYPE` 값이 의도한 스택인지 먼저 확인

2. capability와 카드 노출 일치 여부 확인
- 체인과 무관한 카드가 강제로 뜨지 않는지 확인

3. 자율 실행 결과의 action 이름 확인
- 같은 intent여도 action이 스택별로 달라야 정상

4. Verify/Degraded 판단 기준 확인
- `verify` 결과 PASS/FAIL
- `degraded` 이유가 해당 스택의 컴포넌트 맥락과 맞는지 확인

## 5. 검증 권장 절차

1. `A2 + dry-run`으로 시작
2. 스택별 동일 intent 1개(`stabilize_throughput` 권장)로
   - plan -> execute -> verify 순서 실행
3. 반환된 step/action 목록 비교
   - OP/Thanos vs Orbit vs ZK에서 차이가 나는지 확인
4. write 계열 전환 전
   - approval / rollback 경로 먼저 검증

## 6. 배포 환경별 기능 차이

네트워크 스택 차이와 별개로, 같은 스택이라도 배포 환경에 따라 기능 동작이 달라진다.

### 6.1 환경별 요약

| 환경 | 오케스트레이터 | 스케일링 실행 | 시나리오 주입(`metrics/seed`) | 자율 write 실행 가드 | 운영 포인트 |
|---|---|---|---|---|---|
| 로컬 Docker | `ORCHESTRATOR_TYPE=docker` | 기본적으로 시뮬레이션 아님(`SCALING_SIMULATION_MODE=false` 경로) | 개발 모드에서 사용 가능 | `SENTINAI_API_KEY` 설정 시 write API 인증 필요 | Docker Compose 서비스명/경로 매핑이 정확해야 함 |
| 로컬 K8s(kind/minikube/k3s) | `ORCHESTRATOR_TYPE=k8s` | `SCALING_SIMULATION_MODE` 값에 따라 실제 patch 또는 시뮬레이션 | 개발 모드에서 사용 가능 | 동일 | kubeconfig/namespace/pod label 정합성이 중요 |
| AWS EKS/프로덕션 | `ORCHESTRATOR_TYPE=k8s` + `AWS_CLUSTER_NAME` | 실 patch 운영(일반적으로 `SCALING_SIMULATION_MODE=false`) | 프로덕션(`NODE_ENV=production`)에서 차단 | 동일 + 승인/감사 로그 필수 권장 | read-only/approval/rollback 정책을 반드시 함께 운영 |

### 6.2 운영 제어에 직접 영향 주는 차이

1. `SCALING_SIMULATION_MODE`
- `true`: 대시보드/자율 엔진은 의사결정은 수행하지만 실제 리소스 변경은 하지 않는다.
- `false`: 실제 스케일/재시작 실행 경로로 진입한다.

2. `NODE_ENV`
- `production`에서는 `POST /api/metrics/seed`가 차단된다.
- 즉, Cockpit의 `Stable/Rising/Spike`는 프로덕션 검증 수단이 아니다.

3. 인증/승인 가드
- `SENTINAI_API_KEY`가 설정되면 write 계열 API/MCP는 `x-api-key` 또는 approval 정책을 통과해야 한다.
- 환경이 프로덕션일수록 `A2 dry-run -> A3+ write` 승격 절차를 분리해야 한다.

4. 런타임 탐지/매핑
- Docker: `DOCKER_COMPOSE_FILE`, 서비스명 매핑이 정확해야 컴포넌트 상태 수집/조치가 정상 동작한다.
- K8s: `K8S_NAMESPACE`, `K8S_APP_PREFIX`, statefulset/pod 라벨 규칙이 맞아야 조치가 성공한다.

### 6.3 권장 운영 프로파일

1. 개발/데모
- `A2 + dry-run`, seed 시나리오 기반 검증
- 자율 흐름: `plan -> execute(dry-run) -> verify`

2. 스테이징
- 실제 런타임 연결 + 제한적 write
- approval/rollback 경로를 포함해 최소 1회 이상 리허설

3. 프로덕션
- seed 없이 실트래픽 기반 검증
- write는 위험도/승인 정책과 함께 단계적으로 활성화

## 7. 관련 문서

- `docs/guide/runbook/env-based-operations-profile-quick-decider.md`
- `docs/guide/autonomy-cockpit-user-guide.md`
- `docs/guide/runbook/multistack-autonomous-ops-validation.md`
- `docs/guide/runbook/stack-environment-operations-decision-matrix.md`
- `docs/guide/api-reference.md`
- `docs/guide/architecture.md`
- `docs/guide/setup.md`
- `docs/guide/ec2-setup-guide.md`
