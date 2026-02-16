/**
 * AI-Based Auto-Scaling Types
 * op-geth vCPU Auto-Scaling (1-4 vCPU)
 */

// AI Analysis Severity Level
export type AISeverity = 'low' | 'medium' | 'high' | 'critical';

// Metrics used for scaling decisions
export interface ScalingMetrics {
  cpuUsage: number;        // 0-100%
  txPoolPending: number;   // pending tx count
  gasUsedRatio: number;    // 0-1 (gasUsed/gasLimit)
  aiSeverity?: AISeverity;
}

// Scaling Target vCPU Value
export type TargetVcpu = 1 | 2 | 4 | 8;
export type TargetMemoryGiB = 2 | 4 | 8 | 16;

// Scaling Decision Result
export interface ScalingDecision {
  targetVcpu: TargetVcpu;
  targetMemoryGiB: TargetMemoryGiB;  // vCPU * 2
  reason: string;
  confidence: number;  // 0-1
  score: number;       // 0-100
  breakdown: {
    cpuScore: number;
    gasScore: number;
    txPoolScore: number;
    aiScore: number;
  };
}

// Scaling Execution Result
export interface ScaleResult {
  success: boolean;
  previousVcpu: number;
  currentVcpu: number;
  previousMemoryGiB: number;
  currentMemoryGiB: number;
  timestamp: string;
  message: string;
  error?: string;
  /** Whether zero-downtime mode is enabled */
  zeroDowntime?: boolean;
  /** Rollout phase */
  rolloutPhase?: string;
  /** Rollout duration in milliseconds */
  rolloutDurationMs?: number;
}

// Scaling State
export interface ScalingState {
  currentVcpu: number;
  currentMemoryGiB: number;
  lastScalingTime: string | null;
  lastDecision: ScalingDecision | null;
  cooldownRemaining: number;  // seconds
  autoScalingEnabled: boolean;
}

// Scaling History Entry
export interface ScalingHistoryEntry {
  timestamp: string;
  fromVcpu: number;
  toVcpu: number;
  reason: string;
  triggeredBy: 'auto' | 'manual' | 'cron';
  decision?: ScalingDecision;
}

// API Request Type
export interface ScalerRequest {
  targetVcpu?: TargetVcpu;
  reason?: string;
  dryRun?: boolean;
}

// API Response Type
export interface ScalerResponse {
  success: boolean;
  previousVcpu: number;
  currentVcpu: number;
  decision: ScalingDecision;
  cooldownRemaining?: number;
  dryRun?: boolean;
  error?: string;
}

// K8s StatefulSet Resource Patch Configuration
export interface K8sResourcePatch {
  namespace: string;
  statefulSetName: string;
  containerIndex: number;
  cpuValue: string;
  memoryValue: string;
}

// Scaling Configuration
export interface ScalingConfig {
  minVcpu: number;
  maxVcpu: number;
  cooldownSeconds: number;
  namespace: string;
  statefulSetName: string;
  containerIndex: number;
  weights: {
    cpu: number;
    gas: number;
    txPool: number;
    ai: number;
  };
  thresholds: {
    idle: number;     // score < idle → 1 vCPU
    normal: number;   // score < normal → 2 vCPU, else 4 vCPU
    critical?: number; // score >= critical → 8 vCPU (emergency)
  };
  /** op-geth K8s Service name */
  serviceName: string;
}

// Build StatefulSet/Service name from prefix
// e.g., K8S_STATEFULSET_PREFIX=sepolia-thanos-stack → sepolia-thanos-stack-op-geth
const stsPrefix = process.env.K8S_STATEFULSET_PREFIX;
const defaultStsName = stsPrefix ? `${stsPrefix}-op-geth` : 'op-geth';

// Default Scaling Configuration
export const DEFAULT_SCALING_CONFIG: ScalingConfig = {
  minVcpu: 1,
  maxVcpu: 8,
  cooldownSeconds: parseInt(process.env.SCALING_COOLDOWN_SECONDS ?? (process.env.NODE_ENV === 'development' ? '10' : '300')),
  namespace: process.env.K8S_NAMESPACE || 'default',
  statefulSetName: process.env.K8S_STATEFULSET_NAME || defaultStsName,
  containerIndex: 0,
  weights: {
    cpu: 0.3,
    gas: 0.3,
    txPool: 0.2,
    ai: 0.2,
  },
  thresholds: {
    idle: parseInt(process.env.SCALING_IDLE_THRESHOLD ?? '30'),
    normal: parseInt(process.env.SCALING_NORMAL_THRESHOLD ?? '70'),
    critical: parseInt(process.env.SCALING_CRITICAL_THRESHOLD ?? '85'),
  },
  serviceName: process.env.K8S_SERVICE_NAME || defaultStsName,
};

// Simulation Mode Configuration
export interface SimulationConfig {
  enabled: boolean;
  mockCurrentVcpu: number;
  mockMetrics?: Partial<ScalingMetrics>;
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  enabled: true,  // Default: Simulation mode enabled (Safe)
  mockCurrentVcpu: 1,
};

// AI Severity → Score Mapping
export const AI_SEVERITY_SCORES: Record<AISeverity, number> = {
  low: 0,
  medium: 33,
  high: 66,
  critical: 100,
};
