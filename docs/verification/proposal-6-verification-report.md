# Proposal 6 구현 검증 리포트
**일시:** 2026-02-08 15:45 KST
**검증자:** Claude (AI Assistant)

---

## 1. 개요

Proposal 6 (Zero-Downtime Scaling)의 구현 상태를 검증한다.
Proposal은 2단계 접근을 권장했으며, 구현은 **Phase 2 (Parallel Pod Swap)**가 완전히 구현되었다.

| 항목 | 상태 |
|------|------|
| Phase 1: Enhanced Rolling Update | ⏭️ Phase 2로 대체 (별도 구현 없음) |
| Phase 2: Parallel Pod Swap | ✅ 완료 |

---

## 2. 빌드 및 정적 분석

| 검증 항목 | 결과 |
|-----------|------|
| ESLint | ✅ 통과 (에러 0건) |
| TypeScript (`tsc --noEmit`) | ✅ 통과 (에러 0건) |
| 테스트 (`vitest run`) | ✅ 39개 전체 통과 (3파일) |

---

## 3. 생성/변경된 파일 목록

### 신규 파일 (2개)

| 파일 | 줄수 | 역할 |
|------|------|------|
| `src/lib/zero-downtime-scaler.ts` | 460 | Parallel Pod Swap 오케스트레이터 (메인 모듈) |
| `src/types/zero-downtime.ts` | 78 | SwapPhase, SwapState, ReadinessCheckResult 등 타입 정의 |

### 변경 파일 (4개)

| 파일 | 변경 내용 |
|------|-----------|
| `src/lib/k8s-scaler.ts` | zero-downtime 모드 분기 추가 (`scaleOpGeth` 내 `zeroDowntimeEnabled` 체크) |
| `src/lib/k8s-config.ts` | `runK8sCommand`에 `stdin` 옵션 지원 추가 (kubectl apply -f - 파이프) |
| `src/types/scaling.ts` | `ScaleResult`에 `zeroDowntime`, `rolloutPhase`, `rolloutDurationMs` 필드 추가. `ScalingConfig`에 `serviceName` 필드 추가 |
| `src/app/api/scaler/route.ts` | GET 응답에 `zeroDowntime.swapState` 포함. PATCH에 `zeroDowntimeEnabled` 설정 지원 |

### 테스트 파일 (3개)

| 파일 | 테스트 수 | 커버리지 |
|------|-----------|----------|
| `src/lib/__tests__/zero-downtime-scaler.test.ts` | 21 | Stmts 97.62%, Lines 97.62% |
| `src/lib/__tests__/k8s-scaler.test.ts` | 11 | Stmts 73.07%, Lines 73.07% |
| `src/lib/__tests__/k8s-config.test.ts` | 7 | Stmts 45.71%, Lines 45.71% |

---

## 4. Proposal 명세 대비 구현 매핑

### 4.1 Phase 2 아키텍처 검증

Proposal이 정의한 5단계 오케스트레이션 흐름과 구현 코드를 비교한다.

| # | Proposal 명세 | 구현 (`zero-downtime-scaler.ts`) | 상태 |
|---|--------------|----------------------------------|------|
| 1 | `createStandbyPod(targetVcpu, targetMemoryGiB)` — 목표 리소스로 임시 Pod 생성 (label: `role=standby`) | `createStandbyPod()` (line 192-258) — 기존 Pod spec에서 리소스 변경 + PVC→emptyDir 교체 + `kubectl apply -f -` | ✅ |
| 2 | `waitForReady(podName, timeoutMs)` — readinessProbe 통과 대기 (polling) | `waitForReady()` (line 266-325) — 10초 간격 폴링, 5분 타임아웃, Pod Ready + RPC L7 검증 (`eth_blockNumber`) | ✅ |
| 3 | `switchTraffic(newPodName, oldPodName)` — Service selector 전환 | `switchTraffic()` (line 334-378) — slot selector 초기 설정 + standby→active, old→draining 라벨 전환 | ✅ |
| 4 | `cleanupOldPod(oldPodName)` — 기존 Pod graceful 종료 | `cleanupOldPod()` (line 385-400) — 30초 drain 대기 + `grace-period=60` 삭제 + `wait --for=delete` | ✅ |
| 5 | `updateStatefulSet(targetVcpu, targetMemoryGiB)` — StatefulSet spec 동기화 | `syncStatefulSet()` (line 408-426) — JSON patch로 리소스 spec 업데이트 | ✅ |

### 4.2 Phase 상태 머신

```
Proposal 정의:
  idle → creating_standby → waiting_ready → switching_traffic → cleanup → syncing_statefulset → completed
  Any failure → rolling_back → failed

구현 (`SwapPhase` 타입):
  'idle' | 'creating_standby' | 'waiting_ready' | 'switching_traffic' |
  'cleanup' | 'syncing_statefulset' | 'completed' | 'failed' | 'rolling_back'
```

**판정: ✅ 일치** — Proposal의 phase flow가 그대로 구현됨.

### 4.3 API 확장 검증

| Proposal 명세 | 구현 | 상태 |
|--------------|------|------|
| `GET /api/scaler` 응답에 zeroDowntime 상태 포함 | `zeroDowntime: { enabled, swapState }` (route.ts line 138-141) | ✅ |
| `POST /api/scaler`에서 `zeroDowntimeEnabled` 분기 | `k8s-scaler.ts`의 `scaleOpGeth()` 내부에서 분기 (line 216-258) | ✅ |
| `PATCH /api/scaler`에서 `zeroDowntimeEnabled` 설정 | `setZeroDowntimeEnabled()` 호출 (route.ts line 304-306) | ✅ |

### 4.4 타입 확장 검증

| Proposal 명세 | 구현 | 상태 |
|--------------|------|------|
| `ScaleResult`에 `rolloutStatus`, `rolloutDurationMs` 추가 | `zeroDowntime?`, `rolloutPhase?`, `rolloutDurationMs?` 추가 (scaling.ts line 46-51) | ✅ (필드명 일부 변경) |
| `ScalingConfig`에 `serviceName` 추가 | `serviceName: string` 추가 (scaling.ts line 119) | ✅ |
| Zero-downtime 전용 타입 정의 | `zero-downtime.ts` — SwapPhase, SwapState, ReadinessCheckResult, TrafficSwitchResult, ZeroDowntimeResult | ✅ |

### 4.5 k8s-config.ts 확장 검증

| Proposal 명세 | 구현 | 상태 |
|--------------|------|------|
| `kubectl apply/delete` 헬퍼 추가 | `runK8sCommand`에 `stdin` 옵션 추가 (k8s-config.ts line 228-233) | ✅ |
| stdin 파이프 지원 | `echo '...' \| kubectl apply -f -` 패턴으로 구현 | ✅ |
| single quote 이스케이프 | `options.stdin.replace(/'/g, "'\\''")` 처리 | ✅ |

---

## 5. 테스트 커버리지 분석

### 5.1 `zero-downtime-scaler.ts` — 97.62% Statement Coverage

| 테스트 카테고리 | 테스트 수 | 검증 내용 |
|----------------|-----------|-----------|
| 상태 관리 | 5 | `getSwapState` 불변성, `isSwapInProgress` 상태별 반환, `resetSwapState` |
| 정상 흐름 | 1 | 5단계 전체 오케스트레이션 성공 + phaseDurations 기록 |
| 동시 실행 방지 | 1 | swap in progress 시 reject |
| 에러 핸들링 | 3 | createStandbyPod 실패, readiness 타임아웃, switchTraffic 실패 → 롤백 |
| Phase 함수 | 8 | 각 phase의 kubectl 명령 패턴 검증 (manifest 내용, label, patch 등) |
| 롤백 | 3 | standby Pod 삭제 + label 복원, 롤백 자체 실패 시 graceful 처리 |

**미커버 라인 (2.38%):**
- line 313-314: `waitForReady` 내부 catch 블록의 마지막 경로 (타임아웃 경계 조건)
- line 444-445: `rollback` 내부 label 복원 실패 시 warn 로그

### 5.2 `k8s-scaler.ts` — 73.07% Statement Coverage

zero-downtime 관련 분기는 충분히 테스트됨. 미커버 영역은 주로 레거시 kubectl patch 경로와 히스토리/설정 함수.

### 5.3 `k8s-config.ts` — 45.71% Statement Coverage

stdin 지원, 이스케이프, 타임아웃 관련 핵심 로직은 테스트됨. 미커버는 AWS EKS 토큰 생성/캐싱, API URL 자동 감지 로직 (외부 의존성).

---

## 6. 설계 품질 분석

### 6.1 장점

| 항목 | 내용 |
|------|------|
| **Phase 분리** | 5단계가 독립 함수로 명확히 분리되어 있어 단위 테스트와 디버깅이 용이 |
| **롤백 안전성** | 모든 실패 경로에서 standby Pod 삭제 + 기존 Pod label 복원 시도. 롤백 실패 시에도 graceful 처리 |
| **상태 투명성** | `SwapState`에 각 phase 소요시간(`phaseDurations`)을 기록하여 모니터링/디버깅 가능 |
| **불변 API** | `getSwapState()`가 deep copy를 반환하여 외부에서 내부 상태 변경 불가 |
| **PVC 전략** | emptyDir + snap sync 방식으로 EBS RWO 충돌 회피 (Proposal Option 3) |
| **RPC L7 체크** | readinessProbe 외에 `eth_blockNumber` 실제 호출로 애플리케이션 수준 가용성 검증 |
| **테스트 설계** | `_testHooks`로 sleep을 no-op 처리하여 테스트 속도 27ms 달성 |

### 6.2 주의사항 및 개선 고려 사항

| # | 항목 | 심각도 | 내용 |
|---|------|:------:|------|
| 1 | **Phase 1 미구현** | 낮음 | Proposal은 Phase 1 (Enhanced Rolling Update)을 Phase 2의 기반으로 권장했으나, Phase 2만 단독 구현됨. Phase 2가 더 우수한 솔루션이므로 실질적 문제는 없으나, `zeroDowntimeEnabled=false`일 때의 레거시 경로는 여전히 rollout 대기 없이 즉시 반환함 |
| 2 | **emptyDir 초기 동기화 시간** | 중간 | PVC를 emptyDir로 교체하므로 standby Pod는 snap sync로 chaindata를 처음부터 동기화해야 함. 네트워크 상태에 따라 readiness 5분 타임아웃 내에 완료되지 않을 수 있음 |
| 3 | **StatefulSet updateStrategy** | 중간 | `syncStatefulSet()` 실행 시 StatefulSet의 `updateStrategy`가 `RollingUpdate`(기본값)이면 spec 변경 후 기존 Pod가 자동 교체될 수 있음. Proposal에서 `updateStrategy: OnDelete` 설정을 권장했으나 코드에서 이를 강제하지 않음 |
| 4 | **Service selector 복원** | 낮음 | 전체 프로세스 완료 후 Service에 남아있는 `slot=active` selector가 StatefulSet에서 새로 생성하는 Pod에도 자동 적용되는지 확인 필요. StatefulSet이 생성하는 Pod에는 `slot` label이 없을 수 있음 |
| 5 | **stdin 보안** | 낮음 | `k8s-config.ts`에서 stdin을 `echo '...' \|` 패턴으로 전달하는데, single quote 이스케이프는 처리하지만 대용량 JSON manifest에서 셸 인자 길이 제한에 걸릴 수 있음 |
| 6 | **인메모리 상태** | 정보 | `swapState`가 서버 메모리에만 존재하므로 프로세스 재시작 시 swap 진행 중 상태가 유실됨. 현 단계에서는 문제 없으나 프로덕션에서는 고려 필요 |

---

## 7. Proposal 검증 계획 대비 달성도

Proposal Section 7에서 정의한 검증 항목을 기반으로 평가한다.

### 7.1 Phase 2 검증 항목

| # | 검증 항목 | 성공 기준 | 검증 방법 | 상태 |
|---|-----------|-----------|-----------|------|
| 1 | Standby Pod 생성 | standby Pod Running 상태 | 단위 테스트: manifest 구조, label, 리소스 값 검증 | ✅ 테스트 통과 |
| 2 | 트래픽 전환 | 응답 중단 0초 | 단위 테스트: label 전환 순서 검증 (standby→active → old→draining) | ✅ 테스트 통과 |
| 3 | 기존 Pod 정리 | 1개 Pod만 남음 | 단위 테스트: delete + wait --for=delete 호출 검증 | ✅ 테스트 통과 |
| 4 | StatefulSet 동기화 | 최종 리소스 = 목표치 | 단위 테스트: patch 명령 내 리소스 값 검증 | ✅ 테스트 통과 |
| 5 | 롤백 시나리오 | 서비스 영향 없음 | 단위 테스트: 실패 시 standby 삭제 + label 복원 | ✅ 테스트 통과 |
| 6 | RPC 연속 가용성 | 실패 응답 0건 | ⚠️ 실 클러스터 E2E 테스트 필요 (단위 테스트 범위 밖) | 🔲 미검증 |
| 7 | PVC emptyDir 교체 | PVC → emptyDir 변환됨 | 단위 테스트: manifest volumes 검증 | ✅ 테스트 통과 |

### 7.2 검증 범위 한계

- **단위 테스트**로 검증 가능한 항목은 모두 통과 (7/7)
- **E2E 검증** (실 K8s 클러스터에서의 무중단 확인)은 Section 8에서 별도 정의

---

## 8. 실 클러스터 E2E 검증

### 8.1 대상 환경

스테이징 EKS 클러스터에서 수행한다. 프로덕션과 동일한 구성을 사용한다.

| 항목 | 값 |
|------|-----|
| Namespace | `thanos-sepolia` |
| StatefulSet | `sepolia-thanos-stack-op-geth` |
| Service | `sepolia-thanos-stack-op-geth` |
| Container | index 0 (op-geth) |
| 현재 리소스 | 확인 필요 (`kubectl get sts ... -o jsonpath`) |

### 8.2 사전 조건 체크리스트

검증 시작 전 반드시 확인해야 할 항목.

| # | 항목 | 확인 명령 | 성공 기준 |
|---|------|-----------|-----------|
| P-1 | kubectl 접근 | `kubectl cluster-info` | API server 주소 출력 |
| P-2 | Namespace 존재 | `kubectl get ns thanos-sepolia` | Active 상태 |
| P-3 | StatefulSet 존재 | `kubectl get sts sepolia-thanos-stack-op-geth -n thanos-sepolia` | READY 1/1 |
| P-4 | Service 존재 | `kubectl get svc sepolia-thanos-stack-op-geth -n thanos-sepolia` | ClusterIP 또는 LoadBalancer 할당됨 |
| P-5 | Pod 정상 | `kubectl get pods -n thanos-sepolia -l app.kubernetes.io/name=op-geth` | STATUS: Running, READY: 1/1 |
| P-6 | updateStrategy | `kubectl get sts ... -o jsonpath='{.spec.updateStrategy.type}'` | `OnDelete` (아래 명령으로 설정) |
| P-7 | RPC 응답 | `kubectl exec <pod> -n thanos-sepolia -- wget -qO- http://localhost:8545 --post-data='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'` | `result` 필드에 블록 번호 반환 |

**P-6 미충족 시 필수 실행:**
```bash
kubectl patch sts sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -p '{"spec":{"updateStrategy":{"type":"OnDelete"}}}'
```

### 8.3 검증 절차

#### Step 0: 환경 준비

```bash
# kubeconfig 설정
aws eks update-kubeconfig --name <STAGING_CLUSTER_NAME> --region ap-northeast-2

# SentinAI 서버 시작 (시뮬레이션 모드 OFF)
SCALING_SIMULATION_MODE=false \
AWS_CLUSTER_NAME=<STAGING_CLUSTER_NAME> \
npm run dev
```

#### Step 1: RPC 모니터링 시작 (별도 터미널)

스케일링 전/중/후 RPC 가용성을 1초 간격으로 기록한다. 전체 검증 과정에서 중단 없이 실행한다.

```bash
ENDPOINT="http://<op-geth-service-endpoint>:8545"

while true; do
  RESULT=$(curl -s -w "\n%{http_code}" \
    -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    --max-time 3)

  HTTP_CODE=$(echo "$RESULT" | tail -1)
  BODY=$(echo "$RESULT" | head -1)
  BLOCK=$(echo "$BODY" | jq -r '.result // "ERROR"' 2>/dev/null || echo "PARSE_ERROR")

  echo "$(date +%H:%M:%S.%3N) HTTP=$HTTP_CODE block=$BLOCK"
  sleep 1
done | tee rpc-monitor-$(date +%Y%m%d-%H%M%S).log
```

#### Step 2: Zero-Downtime 모드 활성화

```bash
curl -s -X PATCH http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"zeroDowntimeEnabled": true}' | jq

# 확인
curl -s http://localhost:3002/api/scaler | jq '.zeroDowntime'
# 기대값: { "enabled": true, "swapState": { "phase": "idle", ... } }
```

#### Step 3: 스케일업 실행

```bash
# 현재 vCPU 확인
curl -s http://localhost:3002/api/scaler | jq '.currentVcpu'

# 스케일업 (예: 1 → 2 vCPU)
curl -s -X POST http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"targetVcpu": 2, "reason": "E2E verification"}' | jq
```

#### Step 4: 진행 상태 실시간 관찰 (별도 터미널)

```bash
# API 상태 폴링 (2초 간격)
watch -n 2 'curl -s http://localhost:3002/api/scaler | jq "{phase: .zeroDowntime.swapState.phase, target: .zeroDowntime.swapState.targetVcpu, standby: .zeroDowntime.swapState.standbyPodName, error: .zeroDowntime.swapState.error}"'

# Pod 상태 동시 관찰 (별도 터미널)
watch -n 2 'kubectl get pods -n thanos-sepolia -l app.kubernetes.io/name=op-geth -o wide'
```

#### Step 5: 각 Phase별 확인

| Phase | 확인 명령 | 기대 결과 |
|-------|-----------|-----------|
| `creating_standby` | `kubectl get pods -n thanos-sepolia -l role=standby` | standby Pod 1개 (Pending→ContainerCreating) |
| `waiting_ready` | `kubectl get pods -n thanos-sepolia -l role=standby -o wide` | STATUS: Running, READY: 1/1 |
| `switching_traffic` | `kubectl get svc sepolia-thanos-stack-op-geth -n thanos-sepolia -o jsonpath='{.spec.selector}'` | `slot: active` selector 포함 |
| `cleanup` | `kubectl get pods -n thanos-sepolia` | old Pod Terminating → 삭제 |
| `syncing_statefulset` | `kubectl get sts ... -o jsonpath='{.spec.template.spec.containers[0].resources}'` | 목표 리소스 반영 |
| `completed` | `kubectl get pods -n thanos-sepolia` | 1개 Pod, 목표 리소스 |

#### Step 6: 결과 수집

```bash
# 최종 API 상태
curl -s http://localhost:3002/api/scaler | jq '.zeroDowntime' > e2e-result.json

# RPC 모니터 로그에서 실패 건수 집계
grep -v "HTTP=200" rpc-monitor-*.log | wc -l

# RPC 모니터 로그에서 비정상 응답 상세
grep -v "HTTP=200" rpc-monitor-*.log

# 최종 Pod 리소스 확인
kubectl get pod -n thanos-sepolia -l app.kubernetes.io/name=op-geth \
  -o jsonpath='{.items[0].spec.containers[0].resources}' | jq
```

### 8.4 E2E 검증 항목 및 판정 기준

| # | 검증 항목 | 판정 기준 | 판정 방법 |
|---|-----------|-----------|-----------|
| E-1 | Standby Pod 생성 | Standby Pod가 Running 상태에 도달 | `kubectl get pods -l role=standby` |
| E-2 | RPC 무중단 | 모니터링 로그에서 non-200 응답 **0건** | `grep -v "HTTP=200" rpc-monitor-*.log \| wc -l` = 0 |
| E-3 | 트래픽 전환 정확성 | Service selector가 standby Pod를 가리킴 | `kubectl get endpoints` 확인, endpoint IP = standby Pod IP |
| E-4 | Old Pod 정리 | 전환 후 old Pod 완전 삭제 | `kubectl get pods` — op-geth Pod 1개만 존재 |
| E-5 | StatefulSet 일관성 | spec 리소스 = 실제 Pod 리소스 | jsonpath로 양측 비교 |
| E-6 | API 응답 정확성 | `finalPhase: "completed"`, `success: true` | `e2e-result.json` 확인 |
| E-7 | Phase 소요 시간 | 전체 `totalDurationMs` < 300,000ms (5분) | `e2e-result.json`의 `phaseDurations` |
| E-8 | 스케일 다운 | 역방향 스케일링(2→1 vCPU)도 동일하게 동작 | Step 3~6을 역방향으로 반복 |

### 8.5 롤백 검증 (선택)

의도적 실패를 유발하여 기존 서비스가 영향받지 않는지 확인한다.

**시나리오 A: Standby Pod 시작 실패**

```bash
# op-geth 이미지를 존재하지 않는 태그로 임시 변경 후 스케일링 시도
# → 5분 타임아웃 후 자동 롤백
# → 기대: 기존 Pod 정상 유지, RPC 중단 없음
```

**시나리오 B: RPC readiness 실패**

```bash
# standby Pod에서 op-geth 프로세스가 비정상 → eth_blockNumber 실패
# → waitForReady 타임아웃 → 롤백
# → 기대: standby Pod 삭제, 기존 Pod label 복원
```

**롤백 판정 기준:**

| # | 검증 항목 | 판정 기준 |
|---|-----------|-----------|
| R-1 | 서비스 연속성 | RPC 모니터링 로그에서 non-200 응답 **0건** |
| R-2 | Standby 정리 | 롤백 후 standby Pod 완전 삭제 |
| R-3 | Label 복원 | 기존 Pod의 `slot=active` label 복원 확인 |
| R-4 | API 상태 | `finalPhase: "failed"`, 적절한 `error` 메시지 |

### 8.6 E2E 검증 시 주의사항

| # | 주의 항목 | 상세 |
|---|-----------|------|
| 1 | **updateStrategy: OnDelete 필수** | 미설정 시 `syncStatefulSet` 단계에서 StatefulSet 컨트롤러가 Pod를 자동 교체하여 다운타임 발생. 검증 전 반드시 Section 8.2 P-6 확인 |
| 2 | **emptyDir snap sync 시간** | chaindata 크기에 따라 snap sync에 5분 이상 소요될 수 있음. 타임아웃 실패 시 `waitForReady`의 `timeoutMs` 파라미터 증가 고려 (코드 수정 필요) |
| 3 | **Fargate 프로비저닝 지연** | standby Pod의 micro-VM 할당에 1~3분 소요. `creating_standby` phase에서 대부분의 시간 소비 예상 |
| 4 | **Service slot selector 잔존** | 검증 완료 후 Service에 `slot` selector가 남아있음. StatefulSet이 새로 생성하는 Pod에 자동으로 `slot=active` label이 부여되지 않으므로, 검증 후 수동 정리 또는 운영 절차 수립 필요 |
| 5 | **동시 스케일링 방지** | swap 진행 중 추가 스케일링 요청은 자동 거부됨 (`Swap already in progress`). 검증 중 수동/자동 스케일링 트리거 비활성화 권장 |

---

## 9. 결론

### 9.1 종합 평가

| 항목 | 평가 |
|------|------|
| Proposal 충실도 | **높음** — Phase 2의 5단계 오케스트레이션, 롤백, 타입, API 확장 모두 구현됨 |
| 코드 품질 | **양호** — 단일 책임 원칙 준수, 에러 핸들링 명시적, 테스트 커버리지 97.62% |
| 테스트 충실도 | **높음** — 정상/실패/경계 조건 21개 시나리오, mock 기반 격리 테스트 |
| 프로덕션 준비도 | **중간** — 단위 테스트 완료, E2E 검증 절차 정의됨, updateStrategy 설정 확인 필요 |

### 9.2 프로덕션 배포 전 필수 확인 사항

1. StatefulSet `updateStrategy`를 `OnDelete`로 설정 (syncStatefulSet 후 자동 Pod 교체 방지)
2. 스테이징 클러스터에서 Section 8 E2E 검증 수행 및 전체 통과
3. op-geth snap sync 소요 시간이 5분 타임아웃 내 완료 가능한지 검증
4. 검증 완료 후 Service slot selector 운영 절차 수립

### 9.3 판정

**✅ 구현 검증 통과** — Proposal 6의 Phase 2 (Parallel Pod Swap) 구현이 명세에 부합하며, 단위 테스트를 통해 핵심 로직의 정확성이 확인되었다. E2E 검증 절차 및 판정 기준이 정의되었으며, 스테이징 클러스터에서의 검증 수행 후 프로덕션 배포가 가능하다.
