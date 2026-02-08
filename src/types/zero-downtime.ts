/**
 * Zero-Downtime Scaling Types
 * Parallel Pod Swap 오케스트레이션에 사용되는 타입 정의
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

/** 초기 SwapState */
export const INITIAL_SWAP_STATE: SwapState = {
  phase: 'idle',
  startedAt: null,
  completedAt: null,
  standbyPodName: null,
  targetVcpu: 0,
  targetMemoryGiB: 0,
  error: null,
  phaseDurations: {},
};
