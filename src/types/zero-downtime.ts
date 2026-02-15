/**
 * Zero-Downtime Scaling Types
 * Type definitions used for Parallel Pod Swap orchestration
 */

/** Orchestration phase */
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

/** Orchestration state (in-memory singleton) */
export interface SwapState {
  /** Current phase */
  phase: SwapPhase;
  /** Start time */
  startedAt: string | null;
  /** Completion time */
  completedAt: string | null;
  /** Standby Pod name */
  standbyPodName: string | null;
  /** Target vCPU */
  targetVcpu: number;
  /** Target Memory GiB */
  targetMemoryGiB: number;
  /** Error message */
  error: string | null;
  /** Duration per phase (ms) */
  phaseDurations: Partial<Record<SwapPhase, number>>;
}

/** Pod readiness check result */
export interface ReadinessCheckResult {
  ready: boolean;
  podIp: string | null;
  rpcResponsive: boolean;
  blockNumber: number | null;
  checkDurationMs: number;
}

/** Traffic switch result */
export interface TrafficSwitchResult {
  success: boolean;
  previousSelector: Record<string, string>;
  newSelector: Record<string, string>;
  serviceName: string;
}

/** Overall orchestration result */
export interface ZeroDowntimeResult {
  success: boolean;
  /** Total duration (ms) */
  totalDurationMs: number;
  /** Duration per phase */
  phaseDurations: Partial<Record<SwapPhase, number>>;
  /** Final phase */
  finalPhase: SwapPhase;
  error?: string;
}

/** Initial SwapState */
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
