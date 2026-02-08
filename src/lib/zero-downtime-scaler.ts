/**
 * Zero-Downtime Scaler Module
 * Parallel Pod Swap orchestration for zero-downtime vertical scaling
 *
 * Phase flow:
 *   creating_standby → waiting_ready → switching_traffic → cleanup → syncing_statefulset → completed
 *   Any failure → rolling_back → failed
 */

import { runK8sCommand } from '@/lib/k8s-config';
import {
  SwapState,
  SwapPhase,
  ReadinessCheckResult,
  TrafficSwitchResult,
  ZeroDowntimeResult,
  INITIAL_SWAP_STATE,
} from '@/types/zero-downtime';
import { ScalingConfig, DEFAULT_SCALING_CONFIG } from '@/types/scaling';

// ============================================================
// Singleton State
// ============================================================

let swapState: SwapState = { ...INITIAL_SWAP_STATE };

// ============================================================
// Test Hooks — override internal behavior for testing
// ============================================================

/** @internal Override for testing — replaces sleep with no-op, exposes state setter */
export const _testHooks = {
  sleep: (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms)),
  /** Force swap state phase for testing concurrent rejection */
  _setPhase: (phase: SwapPhase): void => { swapState.phase = phase; },
};

// ============================================================
// Export Functions
// ============================================================

/** 현재 오케스트레이션 상태 조회 (복사본 반환) */
export function getSwapState(): SwapState {
  return { ...swapState, phaseDurations: { ...swapState.phaseDurations } };
}

/** 스왑 진행 중 여부 (idle/completed/failed 이외) */
export function isSwapInProgress(): boolean {
  return !['idle', 'completed', 'failed'].includes(swapState.phase);
}

/** 상태 초기화 (테스트/디버깅용) */
export function resetSwapState(): void {
  swapState = { ...INITIAL_SWAP_STATE, phaseDurations: {} };
}

/**
 * 메인 오케스트레이션: Zero-Downtime Scaling
 *
 * 1. Standby Pod 생성 (목표 리소스)
 * 2. Ready 대기 (readinessProbe + RPC L7 체크)
 * 3. 트래픽 전환 (Service selector)
 * 4. 기존 Pod 정리
 * 5. StatefulSet spec 동기화
 */
export async function zeroDowntimeScale(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): Promise<ZeroDowntimeResult> {
  if (isSwapInProgress()) {
    return {
      success: false,
      totalDurationMs: 0,
      phaseDurations: {},
      finalPhase: swapState.phase,
      error: 'Swap already in progress',
    };
  }

  const startTime = Date.now();
  let phaseStart = startTime;

  // Reset state for new operation
  resetSwapState();

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
      updatePhase('rolling_back', targetVcpu, targetMemoryGiB);
      await rollback(config);
      recordPhaseDuration('rolling_back', phaseStart);
      return {
        success: false,
        totalDurationMs: Date.now() - startTime,
        phaseDurations: { ...swapState.phaseDurations },
        finalPhase: 'failed',
        error: 'Standby pod failed to become ready',
      };
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

// ============================================================
// Internal Helpers
// ============================================================

function updatePhase(phase: SwapPhase, targetVcpu: number, targetMemoryGiB: number): void {
  swapState.phase = phase;
  swapState.targetVcpu = targetVcpu;
  swapState.targetMemoryGiB = targetMemoryGiB;
  if (phase !== 'idle' && !swapState.startedAt) {
    swapState.startedAt = new Date().toISOString();
  }
}

function recordPhaseDuration(phase: SwapPhase, startTime: number): void {
  swapState.phaseDurations[phase] = Date.now() - startTime;
}


// ============================================================
// Phase Functions
// ============================================================

/**
 * Phase 1: 목표 리소스로 standby Pod 생성
 *
 * 기존 StatefulSet Pod의 spec을 기반으로 리소스만 변경한 독립 Pod을 생성한다.
 * PVC는 emptyDir로 교체 (snap sync).
 */
async function createStandbyPod(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig
): Promise<string> {
  const { namespace, statefulSetName, containerIndex } = config;

  // 1. 기존 active Pod spec 가져오기
  const { stdout: podJson } = await runK8sCommand(
    `get pod ${statefulSetName}-0 -n ${namespace} -o json`,
    { timeout: 30000 }
  );
  const podSpec = JSON.parse(podJson);

  // 2. Standby Pod 이름 생성
  const standbyPodName = `${statefulSetName}-standby-${Date.now()}`;

  // 3. Pod manifest 조립
  const manifest = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: standbyPodName,
      namespace,
      labels: {
        ...(podSpec.metadata?.labels || {}),
        role: 'standby',
        slot: 'standby',
      },
    },
    spec: {
      ...podSpec.spec,
      nodeName: undefined,
      hostname: undefined,
      subdomain: undefined,
      serviceAccountName: podSpec.spec.serviceAccountName,
      containers: podSpec.spec.containers.map((c: Record<string, unknown>, i: number) => {
        if (i === containerIndex) {
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
      // PVC → emptyDir (snap sync)
      volumes: (podSpec.spec.volumes || []).map((v: Record<string, unknown>) => {
        if (v.persistentVolumeClaim) {
          return { name: v.name, emptyDir: {} };
        }
        return v;
      }),
    },
  };

  // 4. kubectl apply
  const manifestStr = JSON.stringify(manifest);
  await runK8sCommand(
    `apply -f - -n ${namespace}`,
    { stdin: manifestStr, timeout: 30000 }
  );

  return standbyPodName;
}

/**
 * Phase 2: Pod Ready + RPC L7 체크
 *
 * 10초 간격으로 폴링하며 최대 5분 대기.
 * K8s readinessProbe 통과 + eth_blockNumber RPC 응답 확인.
 */
async function waitForReady(
  podName: string,
  config: ScalingConfig,
  timeoutMs: number = 300000,
  intervalMs: number = 10000
): Promise<ReadinessCheckResult> {
  const { namespace } = config;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      // 1. Pod Ready 상태 확인
      const { stdout: readyStatus } = await runK8sCommand(
        `get pod ${podName} -n ${namespace} -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'`,
        { timeout: 10000 }
      );

      if (readyStatus.replace(/'/g, '').trim() !== 'True') {
        await _testHooks.sleep(intervalMs);
        continue;
      }

      // 2. Pod IP 가져오기
      const { stdout: podIpRaw } = await runK8sCommand(
        `get pod ${podName} -n ${namespace} -o jsonpath='{.status.podIP}'`,
        { timeout: 10000 }
      );
      const podIp = podIpRaw.replace(/'/g, '').trim();

      // 3. RPC L7 체크 (kubectl exec로 localhost 호출)
      const { stdout: rpcResponse } = await runK8sCommand(
        `exec ${podName} -n ${namespace} -- wget -qO- --timeout=5 http://localhost:8545 --post-data='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`,
        { timeout: 15000 }
      );

      const parsed = JSON.parse(rpcResponse);
      const blockNumber = parseInt(parsed.result, 16);

      return {
        ready: true,
        podIp,
        rpcResponsive: true,
        blockNumber,
        checkDurationMs: Date.now() - startTime,
      };
    } catch {
      // Pod not ready yet — keep polling
      await _testHooks.sleep(intervalMs);
    }
  }

  // Timeout
  return {
    ready: false,
    podIp: null,
    rpcResponsive: false,
    blockNumber: null,
    checkDurationMs: Date.now() - startTime,
  };
}

/**
 * Phase 3: Service selector 변경으로 트래픽 전환
 *
 * 1. Service에 slot selector가 없으면 초기 설정
 * 2. Standby Pod label → slot=active
 * 3. Old Pod label → slot=draining (트래픽 즉시 전환)
 */
async function switchTraffic(
  newPodName: string,
  config: ScalingConfig
): Promise<TrafficSwitchResult> {
  const { namespace, serviceName, statefulSetName } = config;

  // 1. 현재 Service selector 확인
  const { stdout: serviceJson } = await runK8sCommand(
    `get service ${serviceName} -n ${namespace} -o json`,
    { timeout: 10000 }
  );
  const service = JSON.parse(serviceJson);
  const previousSelector = { ...service.spec.selector };

  // 2. slot selector가 없으면 초기 설정
  if (!previousSelector.slot) {
    await runK8sCommand(
      `label pod ${statefulSetName}-0 -n ${namespace} slot=active --overwrite`,
      { timeout: 10000 }
    );
    await runK8sCommand(
      `patch service ${serviceName} -n ${namespace} --type='json' -p='[{"op":"add","path":"/spec/selector/slot","value":"active"}]'`,
      { timeout: 10000 }
    );
  }

  // 3. Standby Pod → active
  await runK8sCommand(
    `label pod ${newPodName} -n ${namespace} slot=active --overwrite`,
    { timeout: 10000 }
  );

  // 4. Old Pod → draining (Service는 slot=active만 선택하므로 트래픽 즉시 전환)
  await runK8sCommand(
    `label pod ${statefulSetName}-0 -n ${namespace} slot=draining --overwrite`,
    { timeout: 10000 }
  );

  return {
    success: true,
    previousSelector,
    newSelector: { ...previousSelector, slot: 'active' },
    serviceName,
  };
}

/**
 * Phase 4: 기존 Pod graceful 종료
 *
 * 30초 drain 대기 후 삭제.
 */
async function cleanupOldPod(podName: string, config: ScalingConfig): Promise<void> {
  const { namespace } = config;

  // Drain 대기
  await _testHooks.sleep(30000);

  await runK8sCommand(
    `delete pod ${podName} -n ${namespace} --grace-period=60`,
    { timeout: 90000 }
  );

  await runK8sCommand(
    `wait --for=delete pod/${podName} -n ${namespace} --timeout=120s`,
    { timeout: 130000 }
  );
}

/**
 * Phase 5: StatefulSet spec 동기화
 *
 * Pod를 직접 조작했으므로, StatefulSet의 선언적 spec을 실제 상태와 일치시킨다.
 * updateStrategy: OnDelete 설정 필수 (자동 Pod 교체 방지).
 */
async function syncStatefulSet(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig
): Promise<void> {
  const { namespace, statefulSetName, containerIndex } = config;

  const patchJson = JSON.stringify([
    { op: 'replace', path: `/spec/template/spec/containers/${containerIndex}/resources/requests/cpu`, value: `${targetVcpu}` },
    { op: 'replace', path: `/spec/template/spec/containers/${containerIndex}/resources/requests/memory`, value: `${targetMemoryGiB}Gi` },
    { op: 'replace', path: `/spec/template/spec/containers/${containerIndex}/resources/limits/cpu`, value: `${targetVcpu}` },
    { op: 'replace', path: `/spec/template/spec/containers/${containerIndex}/resources/limits/memory`, value: `${targetMemoryGiB}Gi` },
  ]);

  await runK8sCommand(
    `patch statefulset ${statefulSetName} -n ${namespace} --type='json' -p='${patchJson}'`,
    { timeout: 30000 }
  );
}

/**
 * 롤백: standby Pod 삭제 + 기존 Pod label 복원
 *
 * 트래픽 전환 전 실패 시 기존 Pod에 영향 없음.
 */
async function rollback(config: ScalingConfig): Promise<void> {
  const { namespace, statefulSetName } = config;

  // Standby Pod 삭제
  if (swapState.standbyPodName) {
    try {
      await runK8sCommand(
        `delete pod ${swapState.standbyPodName} -n ${namespace} --grace-period=0 --force`,
        { timeout: 30000 }
      );
    } catch (error) {
      console.warn('[ZeroDowntime] Failed to delete standby pod during rollback:', error);
    }
  }

  // 기존 Pod label 복원
  try {
    await runK8sCommand(
      `label pod ${statefulSetName}-0 -n ${namespace} slot=active --overwrite`,
      { timeout: 10000 }
    );
  } catch (error) {
    console.warn('[ZeroDowntime] Failed to restore label during rollback:', error);
  }

  swapState.phase = 'failed';
}
