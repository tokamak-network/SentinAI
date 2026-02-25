# 스택 × 배포환경 운영 의사결정 매트릭스

기준일: 2026-02-24

이 문서는 SentinAI 운영 시
- 네트워크 스택(Thanos / OP Stack / Arbitrum Orbit / ZK Stack)
- 배포 환경(Local Docker / Local K8s / EKS Production)
을 동시에 고려해 어떤 기능을 어떤 정책으로 운영해야 하는지 결정하기 위한 표준 매트릭스다.

## 1. 사용 방법

1. 먼저 `CHAIN_TYPE`으로 스택 행을 고른다.
2. 다음으로 현재 배포 환경 열(Local Docker / Local K8s / EKS)을 고른다.
3. 교차 셀의 권장 운영 모드(A-level, dry-run/write, 승인 요구)를 따른다.
4. write 활성화 전 `verify/rollback` 검증 완료 여부를 확인한다.

## 2. 공통 게이트

모든 스택/환경에서 아래 게이트를 공통 적용한다.

- 인증 게이트:
  - `SENTINAI_API_KEY`가 설정되면 write API/MCP는 인증 필요
- 정책 게이트:
  - 기본 `A2 + dry-run`
  - `A3+` write는 위험도/승인 정책 통과 후 허용
- 검증 게이트:
  - `plan -> execute -> verify -> rollback` 경로를 먼저 통과

## 3. 운영 의사결정 매트릭스

| 스택 \ 환경 | Local Docker | Local K8s (kind/minikube/k3s) | EKS Production |
|---|---|---|---|
| Thanos | **권장 모드**: A2 dry-run<br/>**핵심 액션**: `scale_execution`, `restart_proposer`<br/>**주의**: compose 파일/서비스명 매핑 우선 확인 | **권장 모드**: A2 dry-run -> 제한적 A3<br/>**핵심 액션**: OP 계열 restart/scale<br/>**주의**: namespace/label/statefulset 정합성 | **권장 모드**: A2 시작, 승인 기반 A3+ 점진 전환<br/>**핵심 액션**: write는 approval+audit 필수<br/>**주의**: seed 금지, 실트래픽 검증만 |
| OP Stack | **권장 모드**: A2 dry-run<br/>**핵심 액션**: `restart_batcher`, `restart_proposer`, `scale_execution`<br/>**주의**: local compose topology 동기화 | **권장 모드**: A2 -> A3(저위험 write)<br/>**핵심 액션**: sequencer path 복구 중심<br/>**주의**: K8s 권한/리소스 patch 권한 점검 | **권장 모드**: A2 고정으로 시작 후 단계 승격<br/>**핵심 액션**: low-risk write부터 점진 허용<br/>**주의**: rollback 자동경로 사전 리허설 필수 |
| Arbitrum Orbit | **권장 모드**: A2 dry-run<br/>**핵심 액션**: `scale_sequencer`, `restart_batch_poster`, `restart_validator`<br/>**주의**: Nitro 서비스명 매핑 우선 | **권장 모드**: A2 -> 제한적 A3<br/>**핵심 액션**: poster/validator 복구<br/>**주의**: Orbit 컴포넌트 명칭 alias 정확성 | **권장 모드**: A2 + 승인강화, A3는 저위험만<br/>**핵심 액션**: validator write는 고위험 취급<br/>**주의**: 승인 토큰/감사로그 누락 금지 |
| ZK Stack | **권장 모드**: A2 dry-run<br/>**핵심 액션**: `restart_prover`, `restart_batcher_pipeline`, `scale_core_execution`<br/>**주의**: proof/settlement probe 없으면 카드/검증 축소 | **권장 모드**: A2 중심, 제한적 write<br/>**핵심 액션**: prover/batcher 파이프라인 복구<br/>**주의**: profile(`core-only/full`)에 따라 관측 범위 변동 | **권장 모드**: A2 장기 유지 권장, write는 승인+쿨다운<br/>**핵심 액션**: prover 관련 write는 보수적 운영<br/>**주의**: settlement/proof 지표 기반 검증 필수 |

## 4. 기능 활성/비활성 빠른 판정표

| 항목 | Local Docker | Local K8s | EKS Production |
|---|---|---|---|
| `metrics/seed` | 가능(개발 모드) | 가능(개발 모드) | 차단(`NODE_ENV=production`) |
| 실제 스케일 patch | 가능 (`SCALING_SIMULATION_MODE=false` 전제) | simulation 설정에 따라 다름 | 일반적으로 가능(실운영) |
| Autonomy write API | 키/정책 통과 시 가능 | 키/정책 통과 시 가능 | 키/정책 + 승인/감사 필수 권장 |
| Rollback API | 가능(키 필요) | 가능(키 필요) | 가능(키 필요, 운영절차에 포함 권장) |
| MCP write tool | auth/approval 정책 의존 | auth/approval 정책 의존 | auth/approval 정책 엄격 적용 |

## 5. 권장 승격 시퀀스 (모든 스택 공통)

1. Stage 0: A2 + dry-run
- 목표: plan/execute/verify 흐름 무중단 확인

2. Stage 1: 제한적 write
- 조건: verify PASS 안정화 + rollback 리허설 완료
- 범위: low-risk action만 허용

3. Stage 2: 운영 write 확대
- 조건: 승인/감사/알림 경로 정착
- 범위: 스택별 medium-risk 일부 허용

4. Stage 3: 고위험 자동화 검토
- 조건: 장애 리포트/회고 기준 충족
- 범위: critical은 기본 승인 유지

## 6. 최소 점검 체크리스트

- [ ] `CHAIN_TYPE`, `ORCHESTRATOR_TYPE`가 실제 환경과 일치한다.
- [ ] `SCALING_SIMULATION_MODE` 의도와 실행 모드가 일치한다.
- [ ] `SENTINAI_API_KEY`/`NEXT_PUBLIC_SENTINAI_API_KEY`가 정책에 맞게 설정되었다.
- [ ] `Autonomy Cockpit`에서 `plan -> execute -> verify -> rollback`이 재현된다.
- [ ] write 활성화 전 rollback 경로를 동일 환경에서 검증했다.

## 7. 관련 문서

- `docs/guide/env-based-operations-profile-quick-decider.md`
- `docs/guide/network-stack-dashboard-feature-differences.md`
- `docs/guide/multistack-autonomous-ops-validation.md`
- `docs/guide/autonomy-cockpit-user-guide.md`
- `docs/guide/api-reference.md`
- `docs/guide/setup.md`
