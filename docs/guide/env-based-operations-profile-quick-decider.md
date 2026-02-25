# `.env.local` 기반 운영 프로파일 빠른 판정표

기준일: 2026-02-24

이 문서는 운영자가 현재 `.env.local` 값만으로
- 어떤 운영 프로파일을 적용해야 하는지
- 어떤 기능이 활성/제한되는지
를 즉시 판정할 수 있도록 만든 실전용 가이드다.

## 0. 자동 판정 스크립트

수동 표 해석 대신 아래 명령으로 즉시 판정할 수 있다.

```bash
# Text output
npm run ops:profile

# JSON output
npm run ops:profile:json

# Custom env file
bash scripts/check-ops-profile.sh --env-file=.env.staging --json
```

## 1. 입력값 체크 (최소 8개)

아래 키만 확인하면 대부분의 운영 판단이 가능하다.

- `CHAIN_TYPE`
- `ORCHESTRATOR_TYPE`
- `AWS_CLUSTER_NAME`
- `SCALING_SIMULATION_MODE`
- `NODE_ENV`
- `GOAL_AUTONOMY_LEVEL`
- `SENTINAI_API_KEY`
- `NEXT_PUBLIC_SENTINAI_API_KEY`

## 2. 1분 판정 규칙

1. 배포 환경 판정
- `ORCHESTRATOR_TYPE=docker` -> Local Docker 프로파일
- `ORCHESTRATOR_TYPE=k8s` + `AWS_CLUSTER_NAME` 비어있음 -> Local K8s 프로파일
- `ORCHESTRATOR_TYPE=k8s` + `AWS_CLUSTER_NAME` 설정됨 -> EKS 프로파일

2. 실행 모드 판정
- `SCALING_SIMULATION_MODE=true` -> 의사결정만, 실제 리소스 변경 없음
- `SCALING_SIMULATION_MODE=false` -> 실제 scale/restart/write 가능 경로

3. 데모 기능 판정
- `NODE_ENV=production` -> `metrics/seed` 차단
- 그 외 -> seed 시나리오 사용 가능

4. write 인증 판정
- `SENTINAI_API_KEY` 설정됨 -> write API/MCP에 인증 필요
- `NEXT_PUBLIC_SENTINAI_API_KEY` 불일치/미설정 -> Cockpit write 버튼 일부 실패 가능

## 3. 단일 판정 매트릭스 (환경값 -> 운영 프로파일)

| 조건 조합 | 판정 프로파일 | 기본 권장 모드 | 즉시 해야 할 일 |
|---|---|---|---|
| `docker` + `simulation=false` + `NODE_ENV!=production` | `DEV_DOCKER_ACTIVE` | `A2 + dry-run`, 필요 시 제한 write | compose 경로/서비스명 매핑 확인 후 plan->execute->verify |
| `docker` + `simulation=true` | `DEV_DOCKER_SAFE` | `A2 dry-run 고정` | write 기대치 제거, 검증은 verify 결과 중심 |
| `k8s` + no `AWS_CLUSTER_NAME` + `simulation=true` | `DEV_K8S_SIM` | `A2 dry-run` | namespace/label 정합성 먼저 점검 |
| `k8s` + no `AWS_CLUSTER_NAME` + `simulation=false` | `DEV_K8S_ACTIVE` | `A2 -> 제한적 A3` | patch 권한/kubeconfig 검증 |
| `k8s` + `AWS_CLUSTER_NAME` + `NODE_ENV=production` + `simulation=false` | `PROD_EKS_CONTROLLED` | `A2 시작, 승인 기반 A3+` | seed 금지, 실트래픽 기반 verify/rollback 리허설 |
| `k8s` + `AWS_CLUSTER_NAME` + `NODE_ENV=production` + `simulation=true` | `PROD_EKS_OBSERVE_ONLY` | `A2 dry-run 고정` | 운영 write 비활성 의도인지 정책 확인 |

## 4. 스택별 보정 규칙

프로파일 판정 후 `CHAIN_TYPE`로 액션 해석을 보정한다.

- `thanos`, `optimism`, `op-stack`, `my-l2`
  - OP 계열 액션 중심: `scale_execution`, `restart_batcher`, `restart_proposer`
- `arbitrum`, `arbitrum-orbit`, `nitro`
  - Orbit 계열 액션 중심: `scale_sequencer`, `restart_batch_poster`, `restart_validator`
- `zkstack`, `zksync`, `zk-stack`
  - ZK 계열 액션 중심: `scale_core_execution`, `restart_prover`, `restart_batcher_pipeline`

## 5. 오작동 빠른 진단표

| 증상 | 먼저 볼 env | 원인 가능성 | 조치 |
|---|---|---|---|
| Cockpit에서 write 버튼 실패 | `SENTINAI_API_KEY`, `NEXT_PUBLIC_SENTINAI_API_KEY` | 키 누락/불일치 | 서버/브라우저 키를 동일 값으로 맞춤 |
| seed 버튼 실패(403/405) | `NODE_ENV` | production 모드 제한 | 개발 환경에서만 seed 사용 |
| scale 실행했는데 실제 반영 안 됨 | `SCALING_SIMULATION_MODE` | 시뮬레이션 모드 | `false` 전환 후 재검증 |
| 컴포넌트 상태가 비정상/누락 | `ORCHESTRATOR_TYPE`, compose/K8s 관련 키 | runtime 매핑 불일치 | docker service 또는 k8s prefix/namespace 점검 |
| 예상 스택 액션과 다르게 동작 | `CHAIN_TYPE` | 체인 타입 오설정 | 스택에 맞는 `CHAIN_TYPE` 재설정 |

## 6. 권장 운영 시퀀스

1. 판정
- 본 문서 표로 현재 프로파일 확정

2. 검증
- `Autonomy Cockpit`에서 `plan -> execute(dry-run) -> verify`

3. write 승격
- `A2`에서 충분한 검증 후 `A3`로 단계 승격

4. 운영 고정
- 프로파일명(`PROD_EKS_CONTROLLED` 등)을 런북/온콜 문서에 명시

## 7. 관련 문서

- `docs/guide/stack-environment-operations-decision-matrix.md`
- `docs/guide/network-stack-dashboard-feature-differences.md`
- `docs/guide/multistack-autonomous-ops-validation.md`
- `docs/guide/autonomy-cockpit-user-guide.md`
- `docs/guide/setup.md`
