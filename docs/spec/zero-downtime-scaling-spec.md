# Zero-Downtime Scaling (Parallel Pod Swap) — 구현 명세서

> **목적**: 이 문서를 읽는 AI 에이전트(Claude Opus 4.6)가 추가 질문 없이 구현 → 빌드 → 테스트까지 완료할 수 있는 수준의 명세서.

---

## 1. 문제 정의

### 1.1 현재 상태

SentinAI의 `scaleOpGeth()` 함수(`src/lib/k8s-scaler.ts:110-256`)는 `kubectl patch statefulset`으로 op-geth의 CPU/Memory를 변경한다. AWS Fargate에서는 리소스 변경 = Pod 교체이므로 **3-5분간 RPC가 중단**된다.

```
kubectl patch statefulset    ← StatefulSet spec 변경
  → 기존 Pod 종료 (즉시)     ← RPC 중단 시작
  → Fargate micro-VM 할당    (1-3분)
  → 새 Pod 시작 + 동기화     (1-2분)
  → 서비스 복구              ← 총 3-5분 다운타임
```

### 1.2 문제점

- `runK8sCommand(cmd)` 성공 = StatefulSet spec 변경 완료일 뿐, Pod가 Ready인지 확인하지 않음
- Pod 교체 동안 JSON-RPC(8545), WebSocket(8546), P2P(30303) 모두 중단
- op-batcher, op-proposer가 op-geth에 의존하므로 **L2 체인 전체 중단** 위험

### 1.3 목표

**다운타임 0초**로 vertical scaling 실행. 새 Pod를 미리 준비하고, Ready 확인 후 트래픽을 전환하는 Parallel Pod Swap 방식.

---

## 2. 솔루션: Parallel Pod Swap

### 2.1 전체 흐름

```
[Phase 1: 병렬 준비]
  Service ──→ Pod-old (2 vCPU, label: slot=active)
               Pod-new (4 vCPU, label: slot=standby)  ← 생성 중, 트래픽 없음

[Phase 2: Ready 대기]
  Service ──→ Pod-old (2 vCPU)
               Pod-new (4 vCPU)  ← readinessProbe 통과 대기

[Phase 3: 트래픽 전환]
  Service ──→ Pod-new (4 vCPU, label: slot=active)  ← selector 전환
               Pod-old (2 vCPU)  ← graceful 종료 진행

[Phase 4: 정리]
  Service ──→ Pod-new (4 vCPU)
               StatefulSet spec 동기화 (선언적 일관성 확보)
```

### 2.2 핵심 설계 결정

| 항목 | 결정 | 이유 |
|------|------|------|
| Standby Pod 생성 | 독립 Pod (`kubectl run`) | StatefulSet replica 조작 대신 단순한 Pod 직접 생성 |
| 트래픽 전환 | Service selector 변경 | atomic 전환, 기존 연결 graceful drain |
| PV(chaindata) | snapshot clone | EBS RWO 제약 — 동시 마운트 불가 |
| Readiness 확인 | RPC L7 체크 (`eth_blockNumber`) | HTTP 200만으로는 불충분, 실제 RPC 동작 확인 |
| 롤백 | standby Pod 삭제 | 전환 전 실패 시 기존 Pod 영향 없음 |
| Simulation 모드 | kubectl 없이 상태만 변경 | 기존 패턴 유지 (`simulationConfig.enabled`) |

### 2.3 비용

스케일 이벤트 동안만 2x 리소스 사용 (3-5분).

- Best case (1→2 vCPU, 5분): **$0.0095/이벤트**
- Worst case (1→4 vCPU, 5분): **$0.019/이벤트**
- 월간 (일 2회): **$0.57 ~ $1.14/월**

---

## 3. 파일 구조

```
신규:
  src/lib/zero-downtime-scaler.ts        ← 오케스트레이터 (핵심 모듈)
  src/types/zero-downtime.ts             ← 타입 정의

수정:
  src/lib/k8s-scaler.ts                  ← scaleOpGeth()에 zeroDowntime 모드 분기 추가
  src/types/scaling.ts                   ← ScaleResult에 rollout 필드 추가, ScalingConfig에 zeroDowntime 옵션
  src/app/api/scaler/route.ts            ← PATCH에 zeroDowntimeEnabled 설정 추가, GET 응답에 상태 포함
```

---

## 4. 타입 정의

### 파일: `src/types/zero-downtime.ts`

```typescript
/**
 * Zero-Downtime Scaling Types
 */

/** 오케스트레이션 단계 */
export type SwapPhase =
  | 'idle'
  | 'creating_standby'
  | 'waiting_ready'
  | 'switching_traffic'
  | 'cleanup'
  | 'syncing_statefulset'
  | 'completed'
  | 'failed'
  | 'rolling_back';

/** 오케스트레이션 상태 (메모리 싱글톤) */
export interface SwapState {
  /** 현재 단계 */
  phase: SwapPhase;
  /** 시작 시간 */
  startedAt: string | null;
  /** 완료 시간 */
  completedAt: string | null;
  /** standby Pod 이름 */
  standbyPodName: string | null;
  /** 목표 vCPU */
  targetVcpu: number;
  /** 목표 Memory GiB */
  targetMemoryGiB: number;
  /** 에러 메시지 */
  error: string | null;
  /** 각 단계별 소요 시간 (ms) */
  phaseDurations: Partial<Record<SwapPhase, number>>;
}

/** Pod readiness 체크 결과 */
export interface ReadinessCheckResult {
  ready: boolean;
  podIp: string | null;
  rpcResponsive: boolean;
  blockNumber: number | null;
  checkDurationMs: number;
}

/** 트래픽 전환 결과 */
export interface TrafficSwitchResult {
  success: boolean;
  previousSelector: Record<string, string>;
  newSelector: Record<string, string>;
  serviceName: string;
}

/** 오케스트레이션 전체 결과 */
export interface ZeroDowntimeResult {
  success: boolean;
  /** 총 소요 시간 (ms) */
  totalDurationMs: number;
  /** 각 단계별 소요 시간 */
  phaseDurations: Partial<Record<SwapPhase, number>>;
  /** 최종 상태 */
  finalPhase: SwapPhase;
  error?: string;
}
```

### 파일: `src/types/scaling.ts` — 수정

기존 타입에 다음을 추가:

```typescript
// ScaleResult 인터페이스에 필드 추가
export interface ScaleResult {
  // ... 기존 필드 유지
  success: boolean;
  previousVcpu: number;
  currentVcpu: number;
  previousMemoryGiB: number;
  currentMemoryGiB: number;
  timestamp: string;
  message: string;
  error?: string;
  // 신규 필드
  /** zero-downtime 스케일링 사용 여부 */
  zeroDowntime?: boolean;
  /** rollout 상태 (zero-downtime 모드에서만 사용) */
  rolloutPhase?: string;
  /** rollout 소요 시간 (ms) */
  rolloutDurationMs?: number;
}

// ScalingConfig 인터페이스에 필드 추가
export interface ScalingConfig {
  // ... 기존 필드 유지
  /** op-geth Service 이름 (zero-downtime에서 사용) */
  serviceName: string;
}

// DEFAULT_SCALING_CONFIG에 추가
export const DEFAULT_SCALING_CONFIG: ScalingConfig = {
  // ... 기존 필드 유지
  minVcpu: 1,
  maxVcpu: 4,
  cooldownSeconds: 300,
  namespace: 'thanos-sepolia',
  statefulSetName: 'sepolia-thanos-stack-op-geth',
  containerIndex: 0,
  // 신규
  serviceName: 'sepolia-thanos-stack-op-geth',
  weights: { cpu: 0.3, gas: 0.3, txPool: 0.2, ai: 0.2 },
  thresholds: { idle: 30, normal: 70 },
};
```

---

## 5. 핵심 모듈 구현 명세

### 파일: `src/lib/zero-downtime-scaler.ts`

**역할**: Parallel Pod Swap 오케스트레이션. 새 Pod 생성 → Ready 대기 → 트래픽 전환 → 기존 Pod 정리.

**의존성**:
- `runK8sCommand` from `@/lib/k8s-config`
- 타입: `SwapState`, `SwapPhase`, `ReadinessCheckResult`, `TrafficSwitchResult`, `ZeroDowntimeResult` from `@/types/zero-downtime`
- 타입: `ScalingConfig`, `DEFAULT_SCALING_CONFIG` from `@/types/scaling`

**반드시 읽어야 할 기존 코드**:
- `src/lib/k8s-config.ts` — `runK8sCommand(command, options?)` 시그니처. 자동으로 토큰/서버 URL을 포함하여 kubectl 실행.
- `src/lib/k8s-scaler.ts:197-223` — 기존 kubectl patch 패턴 참조
- `src/types/scaling.ts` — `ScalingConfig`의 `namespace`, `statefulSetName`, `containerIndex`, `serviceName`

#### 5.1 싱글톤 상태

```typescript
let swapState: SwapState = {
  phase: 'idle',
  startedAt: null,
  completedAt: null,
  standbyPodName: null,
  targetVcpu: 0,
  targetMemoryGiB: 0,
  error: null,
  phaseDurations: {},
};
```

#### 5.2 Export 함수

| 함수 | 시그니처 | 설명 |
|------|----------|------|
| `zeroDowntimeScale` | `(targetVcpu: number, targetMemoryGiB: number, config?: ScalingConfig): Promise<ZeroDowntimeResult>` | 메인 오케스트레이션 함수 |
| `getSwapState` | `(): SwapState` | 현재 오케스트레이션 상태 조회 |
| `isSwapInProgress` | `(): boolean` | 스왑 진행 중 여부 (idle/completed/failed 이외) |
| `resetSwapState` | `(): void` | 상태 초기화 (테스트/디버깅용) |

#### 5.3 내부 함수

##### `createStandbyPod`

```typescript
/**
 * 목표 리소스로 standby Pod 생성
 *
 * 기존 StatefulSet의 Pod spec을 가져와서 리소스만 변경한 독립 Pod를 생성.
 * label: app=<prefix>-geth, role=standby
 */
async function createStandbyPod(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig
): Promise<string>
```

**구현 흐름**:
1. 기존 active Pod의 spec 가져오기:
   ```
   kubectl get pod <statefulSetName>-0 -n <namespace> -o json
   ```
2. Pod spec에서 `metadata`, `status`, `nodeName` 등 제거
3. 리소스를 `targetVcpu`/`targetMemoryGiB`로 교체
4. Pod 이름: `<statefulSetName>-standby-<timestamp>`
5. label 추가: `role: standby`, `slot: standby`
6. 기존 label 유지: `app: <prefix>-geth` (Service selector 매칭용 — 단, Service는 `slot=active`로 필터링하므로 트래픽은 받지 않음)
7. `kubectl apply -f -`로 Pod 생성 (JSON을 stdin으로 전달)

**kubectl 명령어 패턴**:
```typescript
// 1. 기존 Pod spec 가져오기
const { stdout: podJson } = await runK8sCommand(
  `get pod ${config.statefulSetName}-0 -n ${config.namespace} -o json`
);
const podSpec = JSON.parse(podJson);

// 2. Pod manifest 조립
const standbyPodName = `${config.statefulSetName}-standby-${Date.now()}`;
const manifest = {
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: {
    name: standbyPodName,
    namespace: config.namespace,
    labels: {
      ...podSpec.metadata.labels,
      role: 'standby',
      slot: 'standby',
    },
  },
  spec: {
    ...podSpec.spec,
    nodeName: undefined,            // Fargate가 새 노드 할당
    hostname: undefined,
    subdomain: undefined,
    containers: podSpec.spec.containers.map((c: any, i: number) => {
      if (i === config.containerIndex) {
        return {
          ...c,
          resources: {
            requests: { cpu: `${targetVcpu}`, memory: `${targetMemoryGiB}Gi` },
            limits: { cpu: `${targetVcpu}`, memory: `${targetMemoryGiB}Gi` },
          },
        };
      }
      return c;
    }),
  },
};

// 3. 볼륨 처리 — 기존 PVC 참조 제거, emptyDir 또는 새 PVC 사용
// (섹션 5.5 PV 전략 참조)

// 4. Pod 생성
const manifestStr = JSON.stringify(manifest);
await runK8sCommand(
  `apply -f - -n ${config.namespace}`,
  { stdin: manifestStr, timeout: 30000 }
);
```

**주의**: `runK8sCommand`은 현재 stdin을 지원하지 않음. 두 가지 옵션:
- **옵션 A (권장)**: manifest를 임시 JSON 문자열로 만들어 `echo '...' | kubectl apply -f -` 패턴 사용
- **옵션 B**: `k8s-config.ts`에 `runK8sCommandWithStdin()` 함수 추가

옵션 A 구현:
```typescript
// exec로 직접 실행 (runK8sCommand 대신)
const manifestStr = JSON.stringify(manifest).replace(/'/g, "'\\''");
await runK8sCommand(
  `apply -f /dev/stdin -n ${config.namespace}`,
  { timeout: 30000, stdin: manifestStr }
);
```

실제로는 `k8s-config.ts`의 `runK8sCommand`를 확장하여 stdin 지원을 추가하는 것이 깔끔. 아래 섹션 6.2 참조.

##### `waitForReady`

```typescript
/**
 * Pod가 Ready 상태가 될 때까지 폴링
 * readinessProbe 통과 + 실제 RPC 응답 확인
 *
 * @param podName - 대기할 Pod 이름
 * @param config - 스케일링 설정
 * @param timeoutMs - 최대 대기 시간 (기본: 300000ms = 5분)
 * @param intervalMs - 폴링 간격 (기본: 10000ms = 10초)
 */
async function waitForReady(
  podName: string,
  config: ScalingConfig,
  timeoutMs: number = 300000,
  intervalMs: number = 10000
): Promise<ReadinessCheckResult>
```

**구현 흐름**:
1. 10초 간격으로 Pod 상태 확인:
   ```
   kubectl get pod <podName> -n <namespace> -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
   ```
2. Ready=True이면 Pod IP 가져오기:
   ```
   kubectl get pod <podName> -n <namespace> -o jsonpath='{.status.podIP}'
   ```
3. RPC L7 체크 (클러스터 내부에서 직접 호출은 불가하므로 kubectl exec 사용):
   ```
   kubectl exec <podName> -n <namespace> -- wget -qO- --timeout=5 http://localhost:8545 --post-data='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   ```
   또는 Pod IP가 접근 가능하다면 `curl`로 직접 호출.
4. blockNumber 파싱 가능하면 `ready: true` 반환
5. 타임아웃 초과 시 `ready: false` 반환

##### `switchTraffic`

```typescript
/**
 * Service selector를 변경하여 트래픽을 새 Pod으로 전환
 */
async function switchTraffic(
  newPodName: string,
  config: ScalingConfig
): Promise<TrafficSwitchResult>
```

**구현 흐름**:
1. 현재 Service의 selector 확인:
   ```
   kubectl get service <serviceName> -n <namespace> -o json
   ```
2. Service에 `slot` selector가 없으면 추가 필요 (초기 설정).
   - 기존 active Pod에 `slot=active` label이 없으면 먼저 추가:
     ```
     kubectl label pod <statefulSetName>-0 -n <namespace> slot=active --overwrite
     ```
   - Service selector에 `slot: active` 추가:
     ```
     kubectl patch service <serviceName> -n <namespace> --type='json' -p='[{"op":"add","path":"/spec/selector/slot","value":"active"}]'
     ```
3. standby Pod의 label을 `slot=active`로 변경:
   ```
   kubectl label pod <newPodName> -n <namespace> slot=active --overwrite
   ```
4. 기존 Pod의 label을 `slot=draining`으로 변경:
   ```
   kubectl label pod <statefulSetName>-0 -n <namespace> slot=draining --overwrite
   ```
   → Service selector가 `slot=active`이므로 트래픽이 즉시 새 Pod으로 전환됨 (atomic)

##### `cleanupOldPod`

```typescript
/**
 * 기존 Pod graceful 종료
 * preStop hook 또는 terminationGracePeriodSeconds 대기
 */
async function cleanupOldPod(
  podName: string,
  config: ScalingConfig
): Promise<void>
```

**구현 흐름**:
1. 30초 대기 (기존 연결 drain)
2. Pod 삭제:
   ```
   kubectl delete pod <podName> -n <namespace> --grace-period=60
   ```
3. 삭제 완료 대기:
   ```
   kubectl wait --for=delete pod/<podName> -n <namespace> --timeout=120s
   ```

##### `syncStatefulSet`

```typescript
/**
 * StatefulSet spec을 최종 상태로 동기화
 * Pod를 직접 조작했으므로, StatefulSet의 선언적 spec을 실제 상태와 일치시킴
 */
async function syncStatefulSet(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig
): Promise<void>
```

**구현 흐름**:
기존 `k8s-scaler.ts`의 kubectl patch 패턴과 동일:
```typescript
const patchJson = JSON.stringify([
  {
    op: 'replace',
    path: `/spec/template/spec/containers/${config.containerIndex}/resources/requests/cpu`,
    value: `${targetVcpu}`,
  },
  {
    op: 'replace',
    path: `/spec/template/spec/containers/${config.containerIndex}/resources/requests/memory`,
    value: `${targetMemoryGiB}Gi`,
  },
  {
    op: 'replace',
    path: `/spec/template/spec/containers/${config.containerIndex}/resources/limits/cpu`,
    value: `${targetVcpu}`,
  },
  {
    op: 'replace',
    path: `/spec/template/spec/containers/${config.containerIndex}/resources/limits/memory`,
    value: `${targetMemoryGiB}Gi`,
  },
]);

await runK8sCommand(
  `patch statefulset ${config.statefulSetName} -n ${config.namespace} --type='json' -p='${patchJson}'`
);
```

**중요**: 이 패치 후 StatefulSet controller가 Pod를 교체하려 할 수 있음. 이를 방지하기 위해 `updateStrategy.type: OnDelete`로 설정되어 있어야 함. 그렇지 않으면 StatefulSet이 이미 교체된 Pod를 다시 교체하려 한다.

##### `rollback`

```typescript
/**
 * 오케스트레이션 실패 시 롤백
 * standby Pod 삭제, Service selector 복원
 */
async function rollback(config: ScalingConfig): Promise<void>
```

**구현 흐름**:
1. standby Pod 삭제 (존재하면):
   ```
   kubectl delete pod <standbyPodName> -n <namespace> --grace-period=0 --force
   ```
2. 기존 Pod의 label 복원:
   ```
   kubectl label pod <statefulSetName>-0 -n <namespace> slot=active --overwrite
   ```
3. swapState를 `failed`로 설정

#### 5.4 메인 오케스트레이션 함수

```typescript
export async function zeroDowntimeScale(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): Promise<ZeroDowntimeResult> {
  // 이미 진행 중이면 거부
  if (isSwapInProgress()) {
    return { success: false, totalDurationMs: 0, phaseDurations: {}, finalPhase: swapState.phase, error: 'Swap already in progress' };
  }

  const startTime = Date.now();
  let phaseStart = startTime;

  try {
    // Phase 1: Create standby pod
    updatePhase('creating_standby', targetVcpu, targetMemoryGiB);
    const standbyPodName = await createStandbyPod(targetVcpu, targetMemoryGiB, config);
    swapState.standbyPodName = standbyPodName;
    recordPhaseDuration('creating_standby', phaseStart);
    phaseStart = Date.now();

    // Phase 2: Wait for ready
    updatePhase('waiting_ready', targetVcpu, targetMemoryGiB);
    const readiness = await waitForReady(standbyPodName, config);
    recordPhaseDuration('waiting_ready', phaseStart);
    phaseStart = Date.now();

    if (!readiness.ready) {
      // 롤백: standby Pod 삭제
      updatePhase('rolling_back', targetVcpu, targetMemoryGiB);
      await rollback(config);
      recordPhaseDuration('rolling_back', phaseStart);
      return { success: false, totalDurationMs: Date.now() - startTime, phaseDurations: swapState.phaseDurations, finalPhase: 'failed', error: 'Standby pod failed to become ready' };
    }

    // Phase 3: Switch traffic
    updatePhase('switching_traffic', targetVcpu, targetMemoryGiB);
    await switchTraffic(standbyPodName, config);
    recordPhaseDuration('switching_traffic', phaseStart);
    phaseStart = Date.now();

    // Phase 4: Cleanup old pod
    updatePhase('cleanup', targetVcpu, targetMemoryGiB);
    await cleanupOldPod(`${config.statefulSetName}-0`, config);
    recordPhaseDuration('cleanup', phaseStart);
    phaseStart = Date.now();

    // Phase 5: Sync StatefulSet
    updatePhase('syncing_statefulset', targetVcpu, targetMemoryGiB);
    await syncStatefulSet(targetVcpu, targetMemoryGiB, config);
    recordPhaseDuration('syncing_statefulset', phaseStart);

    // Done
    updatePhase('completed', targetVcpu, targetMemoryGiB);
    swapState.completedAt = new Date().toISOString();

    return {
      success: true,
      totalDurationMs: Date.now() - startTime,
      phaseDurations: { ...swapState.phaseDurations },
      finalPhase: 'completed',
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[ZeroDowntime] Orchestration failed:', errorMessage);

    // Attempt rollback
    try {
      await rollback(config);
    } catch (rollbackError) {
      console.error('[ZeroDowntime] Rollback also failed:', rollbackError);
    }

    swapState.phase = 'failed';
    swapState.error = errorMessage;

    return {
      success: false,
      totalDurationMs: Date.now() - startTime,
      phaseDurations: { ...swapState.phaseDurations },
      finalPhase: 'failed',
      error: errorMessage,
    };
  }
}
```

#### 5.5 PV(Persistent Volume) 전략

op-geth의 chaindata는 EBS 볼륨(RWO)에 저장된다. 동시에 2개 Pod가 같은 볼륨에 마운트할 수 없으므로:

**옵션 1: PVC 없이 시작 (snap sync)** — 단순하지만 동기화 시간 필요
```typescript
// standby Pod manifest에서 volumeMounts/volumes 중 PVC 참조 제거
// op-geth가 snap sync로 네트워크에서 최신 상태를 받아옴
// readiness 판정: eth_blockNumber 응답 + 블록 높이가 active Pod과 일정 범위 내
```

**옵션 2: EBS snapshot clone** — 빠르지만 AWS API 직접 호출 필요
```typescript
// 1. aws ec2 create-snapshot --volume-id <vol-id>
// 2. aws ec2 create-volume --snapshot-id <snap-id>
// 3. PVC를 새 볼륨으로 생성
// 4. standby Pod에 마운트
```

**이 명세에서는 옵션 1을 기본으로 구현**한다. 이유:
- AWS API 직접 호출이 불필요 (kubectl만으로 완결)
- op-geth는 snap sync가 빠름 (수 분 내 최신 블록 따라잡기)
- PV 관련 복잡도 제거

standby Pod manifest에서 `volumeClaimTemplates` 관련 볼륨을 `emptyDir`로 교체:
```typescript
// volumes에서 PVC 참조를 emptyDir로 교체
manifest.spec.volumes = manifest.spec.volumes?.map((v: any) => {
  if (v.persistentVolumeClaim) {
    return { name: v.name, emptyDir: {} };
  }
  return v;
}) || [];
```

---

## 6. 기존 코드 수정

### 6.1 `src/types/scaling.ts`

**추가 1**: `ScaleResult`에 필드 추가

```typescript
// 기존
export interface ScaleResult {
  success: boolean;
  previousVcpu: number;
  currentVcpu: number;
  previousMemoryGiB: number;
  currentMemoryGiB: number;
  timestamp: string;
  message: string;
  error?: string;
}

// 수정 후
export interface ScaleResult {
  success: boolean;
  previousVcpu: number;
  currentVcpu: number;
  previousMemoryGiB: number;
  currentMemoryGiB: number;
  timestamp: string;
  message: string;
  error?: string;
  /** zero-downtime 모드 사용 여부 */
  zeroDowntime?: boolean;
  /** rollout 단계 */
  rolloutPhase?: string;
  /** rollout 소요 시간 (ms) */
  rolloutDurationMs?: number;
}
```

**추가 2**: `ScalingConfig`에 `serviceName` 추가

```typescript
// 기존 인터페이스에 추가
export interface ScalingConfig {
  // ... 기존 필드
  /** op-geth K8s Service 이름 */
  serviceName: string;
}

// DEFAULT_SCALING_CONFIG에 추가
export const DEFAULT_SCALING_CONFIG: ScalingConfig = {
  // ... 기존 필드
  serviceName: 'sepolia-thanos-stack-op-geth',
};
```

### 6.2 `src/lib/k8s-config.ts` — stdin 지원 추가

기존 `runK8sCommand` 시그니처를 확장:

```typescript
// options 타입에 stdin 추가
export async function runK8sCommand(
  command: string,
  options?: { timeout?: number; stdin?: string }
): Promise<{ stdout: string; stderr: string }>
```

**구현 변경** (`execAsync` 호출 부분):

stdin이 제공되면 `child_process.exec` 대신 `child_process.spawn` 또는 pipe를 사용:

```typescript
if (options?.stdin) {
  // stdin이 필요한 경우 echo + pipe 패턴 사용
  const fullCmd = `echo '${options.stdin.replace(/'/g, "'\\''")}' | ${baseCmd} ${command}`;
  const result = await execAsync(fullCmd, {
    timeout: options?.timeout ?? 10000,
  });
  return result;
}
// 기존 로직 유지
const result = await execAsync(`${baseCmd} ${command}`, {
  timeout: options?.timeout ?? 10000,
});
```

### 6.3 `src/lib/k8s-scaler.ts` — zero-downtime 모드 분기

**수정 위치**: `scaleOpGeth()` 함수 내 실제 kubectl 실행 부분 (line 197 부근)

**추가 import**:
```typescript
import { zeroDowntimeScale, isSwapInProgress, getSwapState } from '@/lib/zero-downtime-scaler';
```

**추가**: 모듈 레벨 상태
```typescript
let zeroDowntimeEnabled = process.env.ZERO_DOWNTIME_SCALING === 'true';

export function isZeroDowntimeEnabled(): boolean {
  return zeroDowntimeEnabled;
}

export function setZeroDowntimeEnabled(enabled: boolean): void {
  zeroDowntimeEnabled = enabled;
}
```

**수정**: `scaleOpGeth()` 함수의 실제 실행 부분 (기존 line 197-241). 현재 코드:

```typescript
  // 현재 코드 (line 197-241)
  try {
    const patchJson = JSON.stringify([...]);
    const cmd = `patch statefulset ...`;
    await runK8sCommand(cmd);
    // 상태 업데이트 ...
    return { success: true, ... };
  } catch (error) {
    // 에러 처리 ...
  }
```

**수정 후**:

```typescript
  try {
    if (zeroDowntimeEnabled) {
      // Zero-downtime mode: Parallel Pod Swap
      const zdResult = await zeroDowntimeScale(targetVcpu, targetMemoryGiB, config);

      if (!zdResult.success) {
        return {
          success: false,
          previousVcpu: currentVcpu,
          currentVcpu: currentVcpu,
          previousMemoryGiB: scalingState.currentMemoryGiB,
          currentMemoryGiB: scalingState.currentMemoryGiB,
          timestamp,
          message: `Zero-downtime scaling failed: ${zdResult.error}`,
          error: zdResult.error,
          zeroDowntime: true,
          rolloutPhase: zdResult.finalPhase,
          rolloutDurationMs: zdResult.totalDurationMs,
        };
      }

      const previousVcpu = scalingState.currentVcpu;
      const previousMemoryGiB = scalingState.currentMemoryGiB;
      scalingState.currentVcpu = targetVcpu;
      scalingState.currentMemoryGiB = targetMemoryGiB;
      scalingState.lastScalingTime = timestamp;

      return {
        success: true,
        previousVcpu,
        currentVcpu: targetVcpu,
        previousMemoryGiB,
        currentMemoryGiB: targetMemoryGiB,
        timestamp,
        message: `Zero-downtime scale: ${previousVcpu} → ${targetVcpu} vCPU (${zdResult.totalDurationMs}ms)`,
        zeroDowntime: true,
        rolloutPhase: 'completed',
        rolloutDurationMs: zdResult.totalDurationMs,
      };
    }

    // Legacy mode: Direct kubectl patch (기존 코드 그대로 유지)
    const patchJson = JSON.stringify([...]);
    // ... 기존 코드 ...
  } catch (error) {
    // ... 기존 에러 처리 ...
  }
```

### 6.4 `src/app/api/scaler/route.ts`

**PATCH 핸들러에 zeroDowntimeEnabled 설정 추가**:

추가 import:
```typescript
import {
  // ... 기존 import
  isZeroDowntimeEnabled,
  setZeroDowntimeEnabled,
} from '@/lib/k8s-scaler';
```

현재 PATCH 핸들러(line 283-309)에서:

```typescript
// 기존 body destructuring에 추가
const { autoScalingEnabled, simulationMode, zeroDowntimeEnabled } = body;

// 기존 if 블록들 뒤에 추가
if (typeof zeroDowntimeEnabled === 'boolean') {
  setZeroDowntimeEnabled(zeroDowntimeEnabled);
}

// 응답에 추가
return NextResponse.json({
  success: true,
  autoScalingEnabled: isAutoScalingEnabled(),
  simulationMode: isSimulationMode(),
  zeroDowntimeEnabled: isZeroDowntimeEnabled(),
});
```

**GET 핸들러 응답에 swap 상태 추가**:

추가 import:
```typescript
import { getSwapState } from '@/lib/zero-downtime-scaler';
```

GET 응답(line 122-134)에 추가:
```typescript
return NextResponse.json({
  // ... 기존 필드
  zeroDowntime: {
    enabled: isZeroDowntimeEnabled(),
    swapState: getSwapState(),
  },
});
```

---

## 7. K8s 사전 조건 (클러스터 매뉴얼 설정)

코드 구현과 별개로 K8s 클러스터에 다음 설정이 필요. 이는 `kubectl`로 직접 실행하거나, Helm values를 변경:

### 7.1 StatefulSet updateStrategy

```yaml
# StatefulSet: sepolia-thanos-stack-op-geth
spec:
  updateStrategy:
    type: OnDelete    # StatefulSet이 자동으로 Pod를 교체하지 않도록
```

```bash
kubectl patch statefulset sepolia-thanos-stack-op-geth \
  -n thanos-sepolia \
  --type='json' \
  -p='[{"op":"replace","path":"/spec/updateStrategy/type","value":"OnDelete"}]'
```

### 7.2 Service에 slot selector 추가

```bash
# 기존 active Pod에 slot label 추가
kubectl label pod sepolia-thanos-stack-op-geth-0 \
  -n thanos-sepolia \
  slot=active

# Service selector에 slot 추가
kubectl patch service sepolia-thanos-stack-op-geth \
  -n thanos-sepolia \
  --type='json' \
  -p='[{"op":"add","path":"/spec/selector/slot","value":"active"}]'
```

### 7.3 readinessProbe 추가 (권장)

```bash
kubectl patch statefulset sepolia-thanos-stack-op-geth \
  -n thanos-sepolia \
  --type='json' \
  -p='[{
    "op":"add",
    "path":"/spec/template/spec/containers/0/readinessProbe",
    "value":{
      "httpGet":{"path":"/","port":8545},
      "initialDelaySeconds":30,
      "periodSeconds":10,
      "failureThreshold":3
    }
  }]'
```

---

## 8. 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `ZERO_DOWNTIME_SCALING` | `false` | zero-downtime 모드 활성화 (`true`/`false`) |

기존 변수(`K8S_NAMESPACE`, `AWS_CLUSTER_NAME` 등)는 변경 없음.

---

## 9. 에러 처리 매트릭스

| 단계 | 실패 시나리오 | 동작 |
|------|--------------|------|
| `creating_standby` | Pod 생성 실패 (리소스 부족) | 에러 반환, 기존 Pod 영향 없음 |
| `waiting_ready` | 5분 타임아웃 (sync 지연) | standby Pod 삭제 → rollback |
| `waiting_ready` | RPC 미응답 | standby Pod 삭제 → rollback |
| `switching_traffic` | Service patch 실패 | standby Pod 삭제, 기존 selector 복원 |
| `cleanup` | 기존 Pod 삭제 실패 | 경고 로그, 수동 정리 필요 (서비스는 이미 전환됨) |
| `syncing_statefulset` | StatefulSet patch 실패 | 경고 로그 (서비스는 이미 전환됨, spec만 불일치) |
| 전체 | 이미 swap 진행 중 | 즉시 거부 (`isSwapInProgress()` 체크) |

**핵심 원칙**: 트래픽 전환 전 실패 시 기존 Pod에 영향 없음. 트래픽 전환 후 실패 시 서비스는 이미 새 Pod에서 동작 중이므로 cleanup/sync 실패는 서비스 영향 없음.

---

## 10. 검증 절차

### 10.1 빌드 검증

```bash
npm run build
npm run lint
```

### 10.2 Simulation 모드 테스트

zero-downtime 모드를 활성화하되 simulation 모드에서 테스트:

```bash
# 1. simulation 모드 + zero-downtime 활성화
curl -X PATCH http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"simulationMode": true, "zeroDowntimeEnabled": true}'

# 2. 스케일링 실행
curl -X POST http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"targetVcpu": 4, "reason": "zero-downtime test"}'

# 3. 상태 확인 — zeroDowntime.swapState 확인
curl http://localhost:3002/api/scaler
```

### 10.3 실제 클러스터 테스트 (K8s 환경 필요)

```bash
# 0. 사전 조건 확인
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.updateStrategy.type}'
# 기대: OnDelete

kubectl get service sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.selector}'
# 기대: slot=active 포함

# 1. RPC 연속 모니터링 시작 (별도 터미널)
while true; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://<op-geth-service>:8545 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}')
  echo "$(date +%H:%M:%S) HTTP $CODE"
  sleep 1
done

# 2. zero-downtime 스케일링 실행
curl -X PATCH http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"simulationMode": false, "zeroDowntimeEnabled": true}'

curl -X POST http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"targetVcpu": 4, "reason": "zero-downtime production test"}'

# 3. 진행 상태 확인 (폴링)
watch -n 2 'curl -s http://localhost:3002/api/scaler | jq .zeroDowntime'

# 4. 검증
# - 모니터링 로그에서 HTTP 200 연속성 확인 (실패 0건)
# - kubectl get pods -n thanos-sepolia  (1개 Pod만 남음)
# - 남은 Pod의 리소스가 4 vCPU인지 확인
```

### 10.4 롤백 테스트

```bash
# standby Pod가 Ready되지 않는 시나리오 시뮬레이션
# (의도적으로 잘못된 이미지나 불가능한 리소스 요청)
# → swapState.phase가 'failed'가 되는지 확인
# → 기존 Pod이 영향받지 않는지 확인
```

---

## 11. 구현 순서

```
Phase 1: 타입 + 인프라
  1. src/types/zero-downtime.ts — 타입 정의
  2. src/types/scaling.ts — ScaleResult, ScalingConfig 수정 (serviceName 추가)
  3. src/lib/k8s-config.ts — runK8sCommand에 stdin 옵션 추가

Phase 2: 핵심 모듈
  4. src/lib/zero-downtime-scaler.ts — 전체 오케스트레이터 구현

Phase 3: 통합
  5. src/lib/k8s-scaler.ts — zeroDowntimeEnabled 상태 + scaleOpGeth 분기
  6. src/app/api/scaler/route.ts — PATCH/GET 확장

Phase 4: 검증
  7. npm run build && npm run lint
  8. simulation 모드 테스트
```

---

## 부록 A: k8s-scaler.ts 수정 대상 코드

```typescript
// src/lib/k8s-scaler.ts — scaleOpGeth() 함수의 실제 실행 부분
// line 197-255 (현재 코드)

  try {
    // Execute kubectl patch command
    const patchJson = JSON.stringify([
      {
        op: 'replace',
        path: `/spec/template/spec/containers/${containerIndex}/resources/requests/cpu`,
        value: `${targetVcpu}`,
      },
      {
        op: 'replace',
        path: `/spec/template/spec/containers/${containerIndex}/resources/requests/memory`,
        value: `${targetMemoryGiB}Gi`,
      },
      {
        op: 'replace',
        path: `/spec/template/spec/containers/${containerIndex}/resources/limits/cpu`,
        value: `${targetVcpu}`,
      },
      {
        op: 'replace',
        path: `/spec/template/spec/containers/${containerIndex}/resources/limits/memory`,
        value: `${targetMemoryGiB}Gi`,
      },
    ]);

    const cmd = `patch statefulset ${statefulSetName} -n ${namespace} --type='json' -p='${patchJson}'`;
    await runK8sCommand(cmd);

    // Update state
    const previousVcpu = scalingState.currentVcpu;
    const previousMemoryGiB = scalingState.currentMemoryGiB;

    scalingState.currentVcpu = targetVcpu;
    scalingState.currentMemoryGiB = targetMemoryGiB;
    scalingState.lastScalingTime = timestamp;

    return {
      success: true,
      previousVcpu,
      currentVcpu: targetVcpu,
      previousMemoryGiB,
      currentMemoryGiB: targetMemoryGiB,
      timestamp,
      message: `Scaled from ${previousVcpu} to ${targetVcpu} vCPU successfully`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Scaling failed:', errorMessage);
    return {
      success: false,
      previousVcpu: currentVcpu,
      currentVcpu: currentVcpu,
      previousMemoryGiB: scalingState.currentMemoryGiB,
      currentMemoryGiB: scalingState.currentMemoryGiB,
      timestamp,
      message: 'Failed to execute kubectl patch',
      error: errorMessage,
    };
  }
```

이 부분을 `if (zeroDowntimeEnabled) { ... } else { 기존 코드 }` 로 감싸는 것이 수정의 핵심.

## 부록 B: runK8sCommand 현재 시그니처

```typescript
// src/lib/k8s-config.ts:202-238
export async function runK8sCommand(
  command: string,
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }>
```

`options`에 `stdin?: string` 필드를 추가하면 된다.

## 부록 C: DEFAULT_SCALING_CONFIG 현재 전체

```typescript
// src/types/scaling.ts:115-132
export const DEFAULT_SCALING_CONFIG: ScalingConfig = {
  minVcpu: 1,
  maxVcpu: 4,
  cooldownSeconds: 300,
  namespace: 'thanos-sepolia',
  statefulSetName: 'sepolia-thanos-stack-op-geth',
  containerIndex: 0,
  weights: {
    cpu: 0.3,
    gas: 0.3,
    txPool: 0.2,
    ai: 0.2,
  },
  thresholds: {
    idle: 30,
    normal: 70,
  },
};
```

여기에 `serviceName: 'sepolia-thanos-stack-op-geth'`을 추가.
