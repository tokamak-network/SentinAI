# Proposal 6: Zero-Downtime Scaling (무중단 수직 스케일링)

## 문서 정보

| 항목 | 내용 |
|------|------|
| 버전 | 1.0.0 |
| 작성일 | 2026-02-06 |
| 유형 | 아키텍처 제안 (코드 구현 계획 포함) |
| 의존성 | Proposal 1 (Predictive Scaling) — 스케일링 결정 후 실행 단계에 해당 |

---

## 1. Overview & Problem Statement

### 1.1 문제 요약

SentinAI의 현재 스케일링 파이프라인은 **vertical scaling 시 서비스 중단**을 유발한다. op-geth의 vCPU/Memory를 변경하면 기존 Pod가 종료되고 새 Pod가 프로비저닝되는 동안 **3-5분간 RPC, P2P, sync 기능이 모두 중단**된다.

### 1.2 다운타임 발생 시퀀스

```
kubectl patch statefulset    StatefulSet spec 변경
        ↓
  기존 Pod 종료 (즉시)       ← RPC 중단 시작
        ↓
  Fargate micro-VM 프로비저닝  (1-3분)
        ↓
  새 Pod 시작                 (30초-1분)
        ↓
  op-geth 초기화 + 동기화     (1-2분)
        ↓
  서비스 복구                 ← RPC 복구 (총 3-5분 후)
```

### 1.3 Fargate micro-VM 아키텍처

AWS Fargate는 각 Pod에 전용 micro-VM을 할당한다. 기존 EC2 노드 그룹과 달리:

- **리소스 변경 = Pod 교체**: CPU/Memory spec을 변경하면 새로운 micro-VM이 필요
- **In-place resize 불가**: K8s 1.27+의 InPlacePodVerticalScaling 미지원
- **프로비저닝 지연**: 새 VM 할당에 1-3분 소요 (EC2 기존 노드는 10-30초)

### 1.4 op-geth 가용성 요구사항

| 기능 | 포트 | 다운타임 영향 |
|------|------|--------------|
| JSON-RPC | 8545 | 트랜잭션 제출/조회 불가, DApp 중단 |
| WebSocket | 8546 | 실시간 이벤트 구독 끊김 |
| P2P | 30303 | 피어 연결 손실, 재동기화 필요 |
| Metrics | 6060 | 모니터링 갭 발생 |

RPC 중단 시 L2 사용자 경험에 직접 영향을 미치며, 특히 배치/시퀀싱 파이프라인(op-batcher, op-proposer)의 의존성으로 인해 **L2 체인 전체의 안정성**에 영향을 줄 수 있다.

---

## 2. Current Architecture Analysis

### 2.1 스케일링 실행 코드

**`src/lib/k8s-scaler.ts`** — `scaleOpGeth()` 함수 (line 110-256)

```typescript
// line 197-223: kubectl patch 실행
const patchJson = JSON.stringify([
  {
    op: 'replace',
    path: `/spec/template/spec/containers/${containerIndex}/resources/requests/cpu`,
    value: `${targetVcpu}`,
  },
  // ... memory requests/limits도 동일 패턴
]);

const cmd = `patch statefulset ${statefulSetName} -n ${namespace} --type='json' -p='${patchJson}'`;
await runK8sCommand(cmd);

// line 225-240: 패치 후 즉시 상태 업데이트 (Pod ready 대기 없음)
scalingState.currentVcpu = targetVcpu;
scalingState.currentMemoryGiB = targetMemoryGiB;
scalingState.lastScalingTime = timestamp;
```

**문제점**: `runK8sCommand()` 성공 = StatefulSet spec 변경 완료일 뿐, 실제 Pod가 ready 상태인지 확인하지 않는다. 클라이언트에게는 스케일링 성공으로 보이지만, 실제로는 Pod 교체가 진행 중이다.

### 2.2 StatefulSet 설정

**`src/types/scaling.ts`** — `DEFAULT_SCALING_CONFIG` (line 115-132)

```typescript
export const DEFAULT_SCALING_CONFIG: ScalingConfig = {
  minVcpu: 1,
  maxVcpu: 4,
  cooldownSeconds: 300,  // 5 minutes
  namespace: 'thanos-sepolia',
  statefulSetName: 'sepolia-thanos-stack-op-geth',
  containerIndex: 0,
  // ...
};
```

- **StatefulSet**: `sepolia-thanos-stack-op-geth`
- **Namespace**: `thanos-sepolia`
- **Container**: index 0 (op-geth 메인 컨테이너)
- **Replica 수**: 1 (코드에서 replica 관련 로직 없음)

### 2.3 K8s 연결 구성

**`src/lib/k8s-config.ts`** — `runK8sCommand()` (line 202-238)

- AWS EKS 토큰 자동 생성 + 10분 캐싱
- `aws eks describe-cluster`로 API URL 자동 감지
- 명령어 타임아웃: 10초 (기본값)

### 2.4 현재 누락 요소

| 항목 | 현재 상태 | 필요 조건 |
|------|-----------|-----------|
| readinessProbe | 미설정 | HTTP GET `:8545/` 체크 필요 |
| preStop hook | 미설정 | Graceful drain 필요 |
| PodDisruptionBudget | 미설정 | `minAvailable: 1` 필요 |
| Rollout 상태 모니터링 | 없음 | `kubectl rollout status` 대기 필요 |
| 트래픽 전환 로직 | 없음 | Service selector 관리 필요 |

---

## 3. Fargate Constraints

### 3.1 EC2 Managed Node vs Fargate 비교

| 항목 | EC2 Managed Node | Fargate |
|------|------------------|---------|
| In-place resize | K8s 1.27+ 지원 | **불가** |
| 노드 프로비저닝 | 기존 노드 활용 (즉시) | 항상 새 micro-VM (1-3분) |
| Pod 교체 속도 | 10-30초 | **2-5분** |
| VPA 지원 | 완전 지원 | **미지원** |
| 비용 모델 | 노드 단위 (예약 가능) | Pod 단위 (온디맨드) |
| Pod 밀도 | 다수 Pod/노드 | 1 Pod = 1 VM |

### 3.2 왜 Fargate에서 무중단 vertical scaling이 어려운가

1. **Atomic VM**: CPU/Memory는 VM 단위로 결정되며, 런타임 변경 불가
2. **스케줄링 지연**: 새 VM 할당에 1-3분 소요 (capacity 확보 과정)
3. **StatefulSet 제약**: replica=1인 StatefulSet은 기존 Pod를 종료해야 새 Pod를 시작
4. **PV 접근 충돌**: EBS 볼륨은 단일 노드에서만 마운트 가능 (RWO 모드)

### 3.3 핵심 제약 요약

> **Fargate에서 리소스 변경은 곧 Pod 교체이며, Pod 교체는 곧 다운타임이다.**
> 이 제약을 우회하려면 "새 Pod를 미리 준비하고, 준비 완료 후 트래픽을 전환"하는 전략이 필요하다.

---

## 4. Approach Comparison

### 4.1 Approach A: Enhanced Rolling Update — 최소 변경

**개요**: 현재 코드에 readinessProbe, preStop hook, rollout 대기 로직을 추가하여 다운타임을 최소화한다.

**변경 사항**:
1. K8s manifest에 readinessProbe 추가: `httpGet :8545/` (initialDelaySeconds: 30)
2. preStop hook: `sleep 30` (graceful shutdown 대기)
3. `terminationGracePeriodSeconds: 120`
4. `k8s-scaler.ts`에 `kubectl rollout status --timeout=300s` 대기 로직 추가

**장점**:
- 기존 코드 최소 변경
- 추가 리소스 비용 없음
- 구현 복잡도 낮음

**한계**:
- **다운타임 완전 제거 불가** — Pod 교체 동안 서비스 중단은 여전히 발생
- 3-5분 → 1-3분으로 단축 (개선이지, 제거가 아님)

**다운타임**: 1-3분 (개선)
**추가 비용**: $0/월
**구현 복잡도**: ★☆☆☆☆

---

### 4.2 Approach B: Blue-Green with Standby — 상시 대기

**개요**: 2개의 StatefulSet을 운영하고 Service selector를 전환하여 무중단 스케일링을 달성한다.

**아키텍처**:
```
                     ┌──────────────────┐
                     │  Service (op-geth) │
                     │  selector: slot=A │
                     └────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              ↓                               ↓
   ┌─────────────────────┐       ┌─────────────────────┐
   │ StatefulSet-A (active)│       │ StatefulSet-B (standby)│
   │ 2 vCPU / 4 GiB       │       │ 1 vCPU / 2 GiB         │
   │ slot=A                │       │ slot=B                  │
   └─────────────────────┘       └─────────────────────┘
```

**스케일링 흐름**:
1. Standby StatefulSet의 리소스를 목표치로 변경
2. 새 Pod가 Ready 될 때까지 대기
3. Service selector를 `slot=B`로 전환
4. 기존 Active StatefulSet 축소

**장점**:
- 다운타임 0초 (완전 무중단)
- 롤백이 쉬움 (selector 복원)

**한계**:
- 상시 standby Pod 비용 발생
- PV(Persistent Volume) 공유 문제 — EBS RWO 제약
- 두 StatefulSet의 동기화 관리 복잡

**다운타임**: 0초
**추가 비용**: ~$41/월 (1 vCPU standby 상시 운영 기준)
**구현 복잡도**: ★★★★☆

> 비용 계산: 1 vCPU × $0.04656/h + 2 GiB × $0.00511/h = $0.05678/h × 720h = **$40.88/월**

---

### 4.3 Approach C: Parallel Pod Swap — 필요 시 생성 (권장)

**개요**: 스케일링 결정 시점에 목표 리소스의 임시 Pod를 새로 생성하고, Ready 확인 후 트래픽을 전환한 다음 기존 Pod를 종료한다.

**아키텍처**:
```
[Phase 1: 병렬 준비]
Service ──→ Pod-old (2 vCPU)
             Pod-new (4 vCPU) ← 생성 중, 트래픽 수신 안 함

[Phase 2: 전환]
Service ──→ Pod-new (4 vCPU) ← Ready 확인 후 selector 전환
             Pod-old (2 vCPU) ← graceful 종료

[Phase 3: 정리]
Service ──→ Pod-new (4 vCPU)
             StatefulSet spec 업데이트 (선언적 일관성)
```

**스케일링 흐름**:
1. **Create**: 목표 리소스로 임시 Pod 생성 (label: `role=standby`)
2. **Wait**: readinessProbe 통과 대기 (최대 5분)
3. **Switch**: Service selector를 새 Pod으로 전환
4. **Cleanup**: 기존 Pod 삭제, StatefulSet spec 동기화
5. **Verify**: 새 Pod에서 RPC 응답 확인

**장점**:
- 다운타임 0초
- Standby 상시 비용 없음
- 롤백 가능 (전환 전 문제 시 새 Pod 삭제)

**한계**:
- 스케일 이벤트 동안 2배 리소스 사용 (3-5분간)
- PV 공유 전략 필요 (chaindata 동기화)
- orchestrator 모듈 구현 필요

**다운타임**: 0초
**추가 비용**: 스케일 이벤트당 ~$0.005-$0.02 (5분간 2x 리소스)
**구현 복잡도**: ★★★☆☆

> 비용 계산 (worst case): 4 vCPU × $0.04656/h + 8 GiB × $0.00511/h = $0.22716/h × (5/60)h = **$0.019/이벤트**

---

### 4.4 Approach D: EC2 Migration + Karpenter — 인프라 전환

**개요**: Fargate에서 EC2 Managed Node(또는 Karpenter)로 전환하여 In-place vertical scaling을 활용한다.

**변경 사항**:
1. EKS 노드 그룹을 EC2 기반으로 마이그레이션
2. Karpenter 설치 및 NodePool 구성
3. VPA(Vertical Pod Autoscaler) 설정
4. K8s 1.27+ InPlacePodVerticalScaling feature gate 활성화

**장점**:
- 네이티브 K8s vertical scaling 지원
- Pod 교체 없이 리소스 변경 가능
- 장기적으로 비용 효율적 (Reserved Instance 활용)

**한계**:
- **인프라 전체 마이그레이션** 필요 — 운영 리스크 매우 높음
- 기존 Fargate 기반 배포 파이프라인 전면 수정
- InPlacePodVerticalScaling은 아직 beta (K8s 1.32 기준)

**다운타임**: 0초 (마이그레이션 완료 후)
**추가 비용**: EC2 인스턴스 관리 비용 (가변적)
**구현 복잡도**: ★★★★★

---

### 4.5 비교 요약

| 항목 | A: Enhanced Rolling | B: Blue-Green | C: Parallel Swap | D: EC2 Migration |
|------|:-------------------:|:-------------:|:----------------:|:----------------:|
| 다운타임 | 1-3분 | 0초 | **0초** | 0초 |
| 추가 비용 | $0/월 | $41/월 | ~$0.01/이벤트 | 가변적 |
| 구현 복잡도 | 낮음 | 높음 | **중간** | 매우 높음 |
| 코드 변경 범위 | 최소 | 대규모 | 중간 | 인프라 전환 |
| PV 공유 문제 | 없음 | 있음 | 있음 | 없음 |
| 롤백 용이성 | 낮음 | 높음 | **높음** | 낮음 |

---

## 5. Recommended Solution — Phase 1 + Phase 2

### 5.1 전략

2단계(Phased Approach)로 점진적 개선:

- **Phase 1** (즉시): Approach A — 기존 코드 강화로 다운타임 최소화
- **Phase 2** (중기): Approach C — Parallel Pod Swap으로 무중단 달성

Phase 1은 Phase 2의 기반이 되며, Phase 1에서 추가한 readinessProbe와 rollout 모니터링은 Phase 2에서도 재사용된다.

### 5.2 Phase 1: Enhanced Rolling Update

#### K8s Manifest 변경

```yaml
# StatefulSet: sepolia-thanos-stack-op-geth
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 120
      containers:
        - name: op-geth
          # readinessProbe 추가
          readinessProbe:
            httpGet:
              path: /
              port: 8545
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
          # livenessProbe 추가
          livenessProbe:
            httpGet:
              path: /
              port: 8545
            initialDelaySeconds: 60
            periodSeconds: 30
            failureThreshold: 5
          # preStop hook 추가
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 30"]
```

#### `k8s-scaler.ts` 코드 변경

`scaleOpGeth()` 함수에 rollout 대기 로직 추가:

```typescript
// 기존: kubectl patch 후 즉시 반환
await runK8sCommand(cmd);

// 변경: kubectl patch 후 rollout 완료까지 대기
await runK8sCommand(cmd);
await runK8sCommand(
  `rollout status statefulset ${statefulSetName} -n ${namespace} --timeout=300s`,
  { timeout: 310000 }  // 310초 (kubectl 300초 + 여유 10초)
);
```

`ScaleResult`에 rollout 상태 필드 추가:

```typescript
export interface ScaleResult {
  // ... 기존 필드
  rolloutStatus?: 'pending' | 'in_progress' | 'completed' | 'failed';
  rolloutDurationMs?: number;
}
```

### 5.3 Phase 2: Parallel Pod Swap

#### 신규 모듈: `src/lib/zero-downtime-orchestrator.ts`

```
zero-downtime-orchestrator.ts
├── createStandbyPod(targetVcpu, targetMemoryGiB)
│   → 목표 리소스로 임시 Pod 생성 (label: role=standby)
├── waitForReady(podName, timeoutMs)
│   → readinessProbe 통과 대기 (polling)
├── switchTraffic(newPodName, oldPodName)
│   → Service selector 전환
├── cleanupOldPod(oldPodName)
│   → 기존 Pod graceful 종료
└── updateStatefulSet(targetVcpu, targetMemoryGiB)
    → StatefulSet spec을 최종 상태로 동기화
```

#### 오케스트레이션 흐름

```typescript
async function zeroDowntimeScale(
  targetVcpu: TargetVcpu,
  targetMemoryGiB: number,
  config: ScalingConfig
): Promise<ScaleResult> {
  // Step 1: Create standby pod with target resources
  const standbyPod = await createStandbyPod(targetVcpu, targetMemoryGiB, config);

  // Step 2: Wait for standby pod to be ready
  const ready = await waitForReady(standbyPod.name, 300000); // 5min timeout
  if (!ready) {
    await cleanupOldPod(standbyPod.name); // Rollback: delete standby
    throw new Error('Standby pod failed to become ready');
  }

  // Step 3: Switch traffic to standby pod
  await switchTraffic(standbyPod.name, config);

  // Step 4: Cleanup old pod
  await cleanupOldPod(config.statefulSetName + '-0');

  // Step 5: Update StatefulSet spec for declarative consistency
  await updateStatefulSet(targetVcpu, targetMemoryGiB, config);

  return { success: true, /* ... */ };
}
```

#### `scaler/route.ts` API 확장

```typescript
// POST /api/scaler
// 기존: scaleOpGeth() 호출
// 변경: zeroDowntimeEnabled 설정에 따라 분기

if (zeroDowntimeEnabled) {
  result = await zeroDowntimeScale(targetVcpu, targetMemoryGiB, config);
} else {
  result = await scaleOpGeth(targetVcpu, targetMemoryGiB, config);
}
```

#### PV(Persistent Volume) 전략

op-geth의 chaindata는 EBS 볼륨(RWO)에 저장된다. 동시에 2개 Pod가 같은 볼륨에 접근할 수 없으므로:

**옵션 1: Snapshot Clone** (권장)
1. 기존 PV의 EBS snapshot 생성
2. Snapshot에서 새 PV 생성
3. Standby Pod에 새 PV 마운트
4. 전환 후 기존 PV 삭제

**옵션 2: EFS 전환**
- EBS(RWO) → EFS(RWX)로 볼륨 타입 변경
- 동시 마운트 가능하나, IOPS 성능 저하 우려

**옵션 3: Fresh Sync**
- Standby Pod를 빈 볼륨으로 시작하고 snap sync로 최신 상태 추적
- 동기화 완료 후 트래픽 전환
- 시간이 오래 걸릴 수 있음 (네트워크 상태에 따라)

---

## 6. Implementation Plan

### 6.1 Phase 1: Enhanced Rolling Update

| 단계 | 작업 | 변경 파일 |
|------|------|-----------|
| 1-1 | K8s manifest에 readinessProbe, preStop hook 추가 | K8s YAML (클러스터) |
| 1-2 | `terminationGracePeriodSeconds: 120` 설정 | K8s YAML (클러스터) |
| 1-3 | `k8s-scaler.ts`에 rollout status 대기 로직 추가 | `src/lib/k8s-scaler.ts` |
| 1-4 | `ScaleResult` 타입에 rollout 상태 필드 추가 | `src/types/scaling.ts` |
| 1-5 | scaler API 응답에 rollout 정보 포함 | `src/app/api/scaler/route.ts` |
| 1-6 | UI에 rollout 진행 상태 표시 | `src/app/page.tsx` |

### 6.2 Phase 2: Parallel Pod Swap

| 단계 | 작업 | 변경 파일 |
|------|------|-----------|
| 2-1 | `zero-downtime-orchestrator.ts` 모듈 작성 | `src/lib/zero-downtime-orchestrator.ts` (신규) |
| 2-2 | orchestrator 타입 정의 | `src/types/scaling.ts` |
| 2-3 | `k8s-config.ts`에 kubectl apply/delete 헬퍼 추가 | `src/lib/k8s-config.ts` |
| 2-4 | scaler API에 zero-downtime 모드 분기 추가 | `src/app/api/scaler/route.ts` |
| 2-5 | PV snapshot/clone 로직 구현 | `src/lib/zero-downtime-orchestrator.ts` |
| 2-6 | UI에 스케일링 진행 단계 표시 (progress stepper) | `src/app/page.tsx` |
| 2-7 | simulation mode 연동 | `src/lib/k8s-scaler.ts` |

---

## 7. Verification Plan

### 7.1 Phase 1 검증

| 항목 | 검증 방법 | 성공 기준 |
|------|-----------|-----------|
| readinessProbe | `kubectl describe pod` 로 probe 설정 확인 | httpGet :8545 설정됨 |
| preStop hook | Pod 종료 시 로그에서 30초 sleep 확인 | 30초 지연 후 SIGTERM |
| rollout 대기 | 스케일링 후 API 응답 시간 측정 | 응답이 rollout 완료 후 반환됨 |
| 다운타임 측정 | RPC 연속 호출 (`eth_blockNumber`) 모니터링 | 다운타임 < 2분 |
| rollout 실패 처리 | 의도적 실패 (잘못된 이미지) 후 에러 반환 확인 | 에러 메시지 + timeout 처리 |

**검증 스크립트 (Phase 1)**:
```bash
# RPC 가용성 연속 모니터링
while true; do
  RESULT=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://<op-geth>:8545 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}')
  echo "$(date +%H:%M:%S) - HTTP $RESULT"
  sleep 1
done
```

### 7.2 Phase 2 검증

| 항목 | 검증 방법 | 성공 기준 |
|------|-----------|-----------|
| Standby Pod 생성 | `kubectl get pods` 로 2개 Pod 확인 | standby Pod Running 상태 |
| 트래픽 전환 | 전환 전후 RPC 연속 호출 | 응답 중단 0초 |
| 기존 Pod 정리 | 전환 후 기존 Pod 삭제 확인 | 1개 Pod만 남음 |
| StatefulSet 동기화 | `kubectl get sts -o yaml` 스펙 확인 | 최종 리소스 = 목표치 |
| 롤백 시나리오 | Standby Pod 실패 시 기존 Pod 유지 확인 | 서비스 영향 없음 |
| RPC 연속 가용성 | 전체 과정에서 1초 간격 RPC 모니터링 | 실패 응답 0건 |

**검증 절차 (Phase 2)**:
1. 1 vCPU 상태에서 모니터링 시작 (1초 간격 `eth_blockNumber`)
2. SentinAI UI에서 4 vCPU로 스케일업 실행
3. 모니터링 로그에서 HTTP 200 연속성 확인
4. Pod 수가 2 → 1로 변경되는 과정 확인
5. 최종 Pod의 리소스가 4 vCPU인지 확인

---

## 8. Cost & Risk Analysis

### 8.1 접근법별 비용 비교

> 기준: AWS Fargate Seoul (ap-northeast-2) — $0.04656/vCPU-hour, $0.00511/GB-hour

| 항목 | A: Enhanced Rolling | B: Blue-Green | C: Parallel Swap | D: EC2 |
|------|:-------------------:|:-------------:|:----------------:|:------:|
| 월 기본 비용 | $0 | $40.88 | $0 | 가변적 |
| 이벤트당 비용 | $0 | $0 | $0.005-$0.019 | $0 |
| 월 예상 (일 2회) | **$0** | **$40.88** | **$0.30-$1.14** | 가변적 |

**Approach C 상세 비용 (일 2회 스케일링 가정)**:
- Best case (1→2 vCPU, 5분): 2 vCPU × $0.04656 + 4 GiB × $0.00511 = $0.1136/h × (5/60) = $0.0095
- Worst case (1→4 vCPU, 5분): 4 vCPU × $0.04656 + 8 GiB × $0.00511 = $0.2271/h × (5/60) = $0.0189
- 월간: $0.0095 × 60 ~ $0.0189 × 60 = **$0.57 ~ $1.14/월**

### 8.2 리스크 분석

| 리스크 | 심각도 | 발생 확률 | 완화 방안 |
|--------|:------:|:---------:|-----------|
| Standby Pod 시작 실패 | 높음 | 낮음 | 타임아웃 + 자동 롤백 (기존 Pod 유지) |
| RPC health check 오탐 | 중간 | 중간 | `eth_blockNumber` 실제 호출로 검증, 단순 TCP 체크 대신 L7 체크 |
| PV 접근 충돌 (EBS RWO) | 높음 | Phase 2에서 발생 | Snapshot clone 방식 사용, 동시 마운트 시도 안 함 |
| 트래픽 전환 중 요청 유실 | 중간 | 낮음 | Service selector 전환은 atomic, 기존 연결은 graceful drain |
| Fargate 용량 부족 | 높음 | 매우 낮음 | 재시도 로직 + 알림, 다른 AZ로 fallback |
| StatefulSet/Pod 상태 불일치 | 중간 | 중간 | Phase 2 Step 5에서 StatefulSet spec 동기화로 해결 |
| EBS snapshot 시간 초과 | 중간 | 낮음 | chaindata 크기에 따라 snapshot 시간 변동, 타임아웃 설정 필요 |

### 8.3 리스크별 상세 완화 방안

**Pod 시작 실패 시**:
```
1. standby Pod 생성
2. 5분 타임아웃 대기
3. 실패 → standby Pod 삭제
4. 기존 Pod 그대로 유지 (서비스 영향 없음)
5. ScaleResult에 error 반환 + 알림
```

**PV 접근 충돌 시 (Phase 2)**:
```
1. EBS snapshot 생성 (기존 PV 기반)
2. snapshot → 새 PVC 생성
3. standby Pod에 새 PVC 마운트
4. 전환 완료 후 기존 PVC 삭제
```

**health check 오탐 방지**:
```
readinessProbe:
  httpGet:
    path: /                  # op-geth JSON-RPC 엔드포인트
    port: 8545
  initialDelaySeconds: 30    # op-geth 초기화 대기
  periodSeconds: 10
  failureThreshold: 3        # 30초 연속 실패 시 NotReady
  successThreshold: 1
```

추가로 orchestrator 내에서 RPC 수준 검증:
```typescript
// readinessProbe 외에 실제 RPC 응답 검증
async function verifyRpcHealth(podIp: string): Promise<boolean> {
  const response = await fetch(`http://${podIp}:8545`, {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1,
    }),
  });
  const data = await response.json();
  return data.result !== undefined;
}
```

---

## 부록: 관련 파일 구조

```
src/
├── lib/
│   ├── k8s-scaler.ts                    # Phase 1 수정 대상
│   ├── k8s-config.ts                    # Phase 2 헬퍼 추가
│   ├── scaling-decision.ts              # 변경 없음 (점수 계산)
│   ├── zero-downtime-orchestrator.ts    # Phase 2 신규
│   └── predictive-scaler.ts             # 변경 없음 (예측)
├── types/
│   └── scaling.ts                       # Phase 1/2 타입 추가
├── app/
│   ├── api/
│   │   └── scaler/route.ts              # Phase 1/2 API 확장
│   └── page.tsx                         # UI 상태 표시
```
