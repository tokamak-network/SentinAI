/**
 * AgentCycleResult type — shared between agent-loop (V1) and v2-cycle-adapter.
 * Extracted here so callers don't depend on @/lib/agent-loop directly.
 */

import type { DetectionResult } from '@/lib/detection-pipeline';
import type { AgentPhaseTraceEntry, DecisionVerification } from '@/types/agent-memory';

export type { DetectionResult, AgentPhaseTraceEntry, DecisionVerification };

export interface AgentCycleResult {
  timestamp: string;
  phase: 'observe' | 'detect' | 'analyze' | 'plan' | 'act' | 'verify' | 'complete' | 'error';
  decisionId?: string;
  phaseTrace?: AgentPhaseTraceEntry[];
  verification?: DecisionVerification;
  degraded?: {
    active: boolean;
    reasons: string[];
  };
  metrics: {
    l1BlockHeight: number;
    l2BlockHeight: number;
    cpuUsage: number;
    txPoolPending: number;
    gasUsedRatio: number;
    batcherBalanceEth?: number;
    proposerBalanceEth?: number;
    challengerBalanceEth?: number;
  } | null;
  detection: DetectionResult | null;
  scaling: {
    score: number;
    currentVcpu: number;
    targetVcpu: number;
    executed: boolean;
    reason: string;
    confidence?: number;
  } | null;
  failover?: {
    triggered: boolean;
    fromUrl: string;
    toUrl: string;
    k8sUpdated: boolean;
  };
  proxydReplacement?: {
    triggered: boolean;
    backendName: string;
    oldUrl: string;
    newUrl: string;
    reason: string;
  };
  goalManager?: {
    enabled: boolean;
    ticked: boolean;
    generatedCount?: number;
    queuedCount?: number;
    suppressedCount?: number;
    queueDepth?: number;
    llmEnhanced?: boolean;
    llmFallbackReason?: string;
    snapshotId?: string;
    dispatched?: boolean;
    dispatchStatus?: string;
    dispatchReason?: string;
    dispatchGoalId?: string;
    dispatchPlanId?: string;
    error?: string;
  };
  error?: string;
}
