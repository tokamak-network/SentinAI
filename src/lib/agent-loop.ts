/**
 * Agent Loop
 * Autonomous observe-decide-act loop that runs server-side without browser dependency.
 * Collects metrics → detects anomalies → evaluates scaling → auto-executes actions.
 */

import { createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { pushMetric, getRecentMetrics } from '@/lib/metrics-store';
import { getStore } from '@/lib/redis-store';
import { recordUsage } from '@/lib/usage-tracker';
import { runDetectionPipeline, type DetectionResult } from '@/lib/detection-pipeline';
import {
  makeScalingDecision,
  mapAIResultToSeverity,
} from '@/lib/scaling-decision';
import {
  scaleOpGeth,
  getCurrentVcpu,
  isAutoScalingEnabled,
  checkCooldown,
  addScalingHistory,
} from '@/lib/k8s-scaler';
import { predictScaling } from '@/lib/predictive-scaler';
import { analyzeLogChunk } from '@/lib/ai-analyzer';
import { getAllLiveLogs } from '@/lib/log-ingester';
import { addScalingEvent } from '@/lib/daily-accumulator';
import { DEFAULT_SCALING_CONFIG, type TargetVcpu } from '@/types/scaling';
import { DEFAULT_PREDICTION_CONFIG } from '@/types/prediction';
import type { MetricDataPoint } from '@/types/prediction';
import type { ScalingMetrics } from '@/types/scaling';

// ============================================================
// Constants
// ============================================================

/** RPC call timeout in milliseconds */
const RPC_TIMEOUT_MS = 15_000;

// ============================================================
// Types
// ============================================================

export interface AgentCycleResult {
  timestamp: string;
  phase: 'observe' | 'detect' | 'decide' | 'act' | 'complete' | 'error';
  metrics: {
    l1BlockHeight: number;
    l2BlockHeight: number;
    cpuUsage: number;
    txPoolPending: number;
    gasUsedRatio: number;
  } | null;
  detection: DetectionResult | null;
  scaling: {
    score: number;
    currentVcpu: number;
    targetVcpu: number;
    executed: boolean;
    reason: string;
  } | null;
  error?: string;
}

// ============================================================
// State
// ============================================================

let running = false;

// ============================================================
// Metrics Collection (Server-side, no HTTP overhead)
// ============================================================

interface CollectedMetrics {
  dataPoint: MetricDataPoint;
  l1BlockHeight: number;
}

async function collectMetrics(): Promise<CollectedMetrics | null> {
  const rpcUrl = process.env.L2_RPC_URL;
  if (!rpcUrl) {
    console.warn('[AgentLoop] L2_RPC_URL not set, skipping metrics collection');
    return null;
  }

  const l1RpcUrl = process.env.L1_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';

  const l2Client = createPublicClient({ chain: mainnet, transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS }) });
  const l1Client = createPublicClient({ chain: sepolia, transport: http(l1RpcUrl, { timeout: RPC_TIMEOUT_MS }) });

  // Parallel RPC fetch
  const [block, l1BlockNumber] = await Promise.all([
    l2Client.getBlock({ blockTag: 'latest' }),
    l1Client.getBlockNumber(),
  ]);

  const blockNumber = block.number;

  // TxPool pending count (with timeout)
  let txPoolPending = 0;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    const txPoolResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'txpool_status',
        params: [],
        id: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const txPoolData = await txPoolResponse.json();
    if (txPoolData.result?.pending) {
      txPoolPending = parseInt(txPoolData.result.pending, 16);
    }
  } catch {
    txPoolPending = block.transactions.length;
  }

  // Gas usage ratio (safe division)
  const gasUsed = Number(block.gasUsed);
  const gasLimit = Number(block.gasLimit);
  const gasUsedRatio = gasLimit > 0 ? gasUsed / gasLimit : 0;
  const cpuUsage = gasUsedRatio * 100; // EVM load as CPU proxy

  // Block interval
  const now = Date.now();
  let blockInterval = 2.0;
  const lastBlock = await getStore().getLastBlock();
  if (lastBlock.height !== null && lastBlock.time !== null) {
    const lastHeight = BigInt(lastBlock.height);
    const lastTime = Number(lastBlock.time);
    if (blockNumber > lastHeight) {
      const timeDiff = (now - lastTime) / 1000;
      const blockDiff = Number(blockNumber - lastHeight);
      blockInterval = timeDiff / blockDiff;
    }
  }
  await getStore().setLastBlock(String(blockNumber), String(now));

  // Get current vCPU from K8s state
  const currentVcpu = await getCurrentVcpu();

  const dataPoint: MetricDataPoint = {
    timestamp: new Date().toISOString(),
    cpuUsage,
    txPoolPending,
    gasUsedRatio,
    blockHeight: Number(blockNumber),
    blockInterval,
    currentVcpu,
  };

  // Push to metrics store and record usage
  await pushMetric(dataPoint);
  recordUsage(currentVcpu, cpuUsage);

  return { dataPoint, l1BlockHeight: Number(l1BlockNumber) };
}

// ============================================================
// Scaling Evaluation & Execution
// ============================================================

function clampToValidVcpu(vcpu: number): TargetVcpu {
  if (vcpu >= 4) return 4;
  if (vcpu >= 2) return 2;
  return 1;
}

async function evaluateAndExecuteScaling(
  dataPoint: MetricDataPoint
): Promise<AgentCycleResult['scaling']> {
  const autoScaling = await isAutoScalingEnabled();
  const currentVcpu = await getCurrentVcpu();
  const cooldown = await checkCooldown();

  // AI analysis for severity (best-effort)
  let aiSeverity: ScalingMetrics['aiSeverity'];
  try {
    const logs = await getAllLiveLogs();
    const aiResult = await analyzeLogChunk(logs);
    aiSeverity = mapAIResultToSeverity(aiResult ? { severity: aiResult.severity } : null);
  } catch {
    aiSeverity = undefined;
  }

  const metrics: ScalingMetrics = {
    cpuUsage: dataPoint.cpuUsage,
    txPoolPending: dataPoint.txPoolPending,
    gasUsedRatio: dataPoint.gasUsedRatio,
    aiSeverity,
  };

  const decision = makeScalingDecision(metrics);

  // Predictive scaling override
  let finalTarget: TargetVcpu = decision.targetVcpu;
  let finalReason = decision.reason;

  const metricsHistory = await getRecentMetrics();
  if (metricsHistory.length >= DEFAULT_PREDICTION_CONFIG.minDataPoints) {
    try {
      const prediction = await predictScaling(currentVcpu);
      if (
        prediction &&
        prediction.confidence >= DEFAULT_PREDICTION_CONFIG.confidenceThreshold &&
        prediction.recommendedAction === 'scale_up' &&
        prediction.predictedVcpu > finalTarget
      ) {
        finalTarget = clampToValidVcpu(prediction.predictedVcpu);
        finalReason = `[Predictive] ${prediction.reasoning} (Confidence: ${(prediction.confidence * 100).toFixed(0)}%)`;
        console.log(`[AgentLoop] Predictive override: ${currentVcpu} → ${finalTarget} vCPU`);
      }
    } catch {
      // Prediction failure is non-fatal
    }
  }

  const result = {
    score: decision.score,
    currentVcpu,
    targetVcpu: finalTarget as number,
    executed: false,
    reason: finalReason,
  };

  // Auto-execute if conditions met
  if (!autoScaling) {
    result.reason = `[Skip] Auto-scaling disabled. ${result.reason}`;
    return result;
  }

  if (cooldown.inCooldown) {
    result.reason = `[Skip] Cooldown ${cooldown.remainingSeconds}s. ${result.reason}`;
    return result;
  }

  if (finalTarget === currentVcpu) {
    result.reason = `[Skip] Already at ${currentVcpu} vCPU. ${result.reason}`;
    return result;
  }

  // Execute scaling
  const targetMemoryGiB = (finalTarget * 2) as 2 | 4 | 8;
  const scaleResult = await scaleOpGeth(finalTarget, targetMemoryGiB, DEFAULT_SCALING_CONFIG);

  if (scaleResult.success && scaleResult.previousVcpu !== scaleResult.currentVcpu) {
    result.executed = true;
    result.reason = `[Executed] ${scaleResult.previousVcpu} → ${scaleResult.currentVcpu} vCPU. ${result.reason}`;

    // Record history
    await addScalingHistory({
      timestamp: scaleResult.timestamp,
      fromVcpu: scaleResult.previousVcpu,
      toVcpu: scaleResult.currentVcpu,
      reason: finalReason,
      triggeredBy: 'auto',
      decision,
    });

    await addScalingEvent({
      timestamp: scaleResult.timestamp,
      fromVcpu: scaleResult.previousVcpu,
      toVcpu: scaleResult.currentVcpu,
      trigger: 'auto',
      reason: finalReason,
    });

    console.log(`[AgentLoop] Scaling executed: ${scaleResult.previousVcpu} → ${scaleResult.currentVcpu} vCPU`);
  }

  return result;
}

// ============================================================
// Main Agent Cycle
// ============================================================

/**
 * Run one agent cycle: observe → detect → decide → act
 */
export async function runAgentCycle(): Promise<AgentCycleResult> {
  if (running) {
    return {
      timestamp: new Date().toISOString(),
      phase: 'error',
      metrics: null,
      detection: null,
      scaling: null,
      error: 'Previous cycle still running',
    };
  }

  running = true;
  const timestamp = new Date().toISOString();

  try {
    // Phase 1: Observe — collect metrics from RPC
    const collected = await collectMetrics();
    if (!collected) {
      return {
        timestamp,
        phase: 'error',
        metrics: null,
        detection: null,
        scaling: null,
        error: 'Metrics collection failed (L2_RPC_URL not configured)',
      };
    }

    const { dataPoint, l1BlockHeight } = collected;

    const metricsResult = {
      l1BlockHeight,
      l2BlockHeight: dataPoint.blockHeight,
      cpuUsage: dataPoint.cpuUsage,
      txPoolPending: dataPoint.txPoolPending,
      gasUsedRatio: dataPoint.gasUsedRatio,
    };

    // Phase 2: Detect — run anomaly detection pipeline
    const detection = await runDetectionPipeline(dataPoint);

    // Phase 3+4: Decide & Act — evaluate scaling and auto-execute
    const scaling = await evaluateAndExecuteScaling(dataPoint);

    return {
      timestamp,
      phase: 'complete',
      metrics: metricsResult,
      detection,
      scaling,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AgentLoop] Cycle failed:', errorMsg);
    return {
      timestamp,
      phase: 'error',
      metrics: null,
      detection: null,
      scaling: null,
      error: errorMsg,
    };
  } finally {
    running = false;
  }
}

/**
 * Check if agent loop is currently running a cycle
 */
export function isAgentRunning(): boolean {
  return running;
}

/**
 * Reset running state (for testing)
 */
export function resetAgentState(): void {
  running = false;
}
