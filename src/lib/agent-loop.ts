/**
 * Agent Loop
 * Autonomous observe-decide-act loop that runs server-side without browser dependency.
 * Collects metrics → detects anomalies → evaluates scaling → auto-executes actions.
 */

import { createPublicClient, http, formatEther } from 'viem';
import { getChainPlugin } from '@/chains';
import { pushMetric, getRecentMetrics } from '@/lib/metrics-store';
import { getStore } from '@/lib/redis-store';
import { recordUsage } from '@/lib/usage-tracker';
import { runDetectionPipeline, type DetectionResult } from '@/lib/detection-pipeline';
import { getActiveL1RpcUrl, reportL1Success, reportL1Failure, checkProxydBackends } from '@/lib/l1-rpc-failover';
import {
  makeScalingDecision,
  mapAIResultToSeverity,
} from '@/lib/scaling-decision';
import {
  scaleOpGeth,
  getCurrentVcpu,
  getContainerCpuUsage,
  isAutoScalingEnabled,
  checkCooldown,
  addScalingHistory,
} from '@/lib/k8s-scaler';
import { predictScaling } from '@/lib/predictive-scaler';
import { analyzeLogChunk } from '@/lib/ai-analyzer';
import { getAllLiveLogs } from '@/lib/log-ingester';
import { addScalingEvent } from '@/lib/daily-accumulator';
import { DEFAULT_SCALING_CONFIG, type TargetVcpu, type TargetMemoryGiB } from '@/types/scaling';
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
    batcherBalanceEth?: number;
    proposerBalanceEth?: number;
  } | null;
  detection: DetectionResult | null;
  scaling: {
    score: number;
    currentVcpu: number;
    targetVcpu: number;
    executed: boolean;
    reason: string;
  } | null;
  failover?: {
    triggered: boolean;
    fromUrl: string;
    toUrl: string;
    k8sUpdated: boolean;
  };
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
  failover?: AgentCycleResult['failover'];
  batcherBalanceEth?: number;
  proposerBalanceEth?: number;
}

async function collectMetrics(): Promise<CollectedMetrics | null> {
  const rpcUrl = process.env.L2_RPC_URL;
  if (!rpcUrl) {
    console.warn('[AgentLoop] L2_RPC_URL not set, skipping metrics collection');
    return null;
  }

  // Check if seed scenario is active
  const activeSeedScenario = await getStore().getSeedScenario();

  // If seed scenario is active (not live), use seed metrics from store
  if (activeSeedScenario && activeSeedScenario !== 'live') {
    const recentMetrics = await getRecentMetrics(1);
    if (recentMetrics && recentMetrics.length > 0) {
      const seedMetric = recentMetrics[0];
      console.info(`[AgentLoop] Using seed metrics (${activeSeedScenario}): CPU=${seedMetric.cpuUsage.toFixed(1)}%, TxPool=${seedMetric.txPoolPending}, vCPU=${seedMetric.currentVcpu}`);
      return {
        dataPoint: seedMetric,
        l1BlockHeight: 0, // Seed metrics don't include L1
      };
    }
  }

  const l2Client = createPublicClient({ chain: getChainPlugin().l2Chain, transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS }) });

  // L2 block fetch
  const block = await l2Client.getBlock({ blockTag: 'latest' });
  const blockNumber = block.number;

  // L1 block fetch with failover support
  let l1BlockNumber: bigint;
  let failoverInfo: AgentCycleResult['failover'] | undefined;

  const l1RpcUrl = getActiveL1RpcUrl();
  const l1Client = createPublicClient({ chain: getChainPlugin().l1Chain, transport: http(l1RpcUrl, { timeout: RPC_TIMEOUT_MS }) });

  try {
    l1BlockNumber = await l1Client.getBlockNumber();
    reportL1Success();
  } catch (l1Error) {
    console.warn('[AgentLoop] L1 RPC failed, attempting failover...');

    const newUrl = await reportL1Failure(
      l1Error instanceof Error ? l1Error : new Error(String(l1Error))
    );

    if (newUrl) {
      // Failover occurred — retry with new endpoint
      const retryClient = createPublicClient({
        chain: getChainPlugin().l1Chain,
        transport: http(newUrl, { timeout: RPC_TIMEOUT_MS }),
      });
      try {
        l1BlockNumber = await retryClient.getBlockNumber();
        reportL1Success();
        failoverInfo = {
          triggered: true,
          fromUrl: l1RpcUrl,
          toUrl: newUrl,
          k8sUpdated: true,
        };
        console.info(`[AgentLoop] L1 RPC failover success: ${newUrl}`);
      } catch {
        // Retry also failed — continue without L1
        console.error('[AgentLoop] L1 RPC retry after failover also failed');
        l1BlockNumber = BigInt(0);
        failoverInfo = {
          triggered: true,
          fromUrl: l1RpcUrl,
          toUrl: newUrl,
          k8sUpdated: true,
        };
      }
    } else {
      // No failover available — continue without L1
      console.warn('[AgentLoop] No failover available, continuing without L1');
      l1BlockNumber = BigInt(0);
    }
  }

  // EOA balance queries (non-blocking)
  let batcherBalanceEth: number | undefined;
  let proposerBalanceEth: number | undefined;

  const batcherAddr = process.env.BATCHER_EOA_ADDRESS as `0x${string}` | undefined;
  const proposerAddr = process.env.PROPOSER_EOA_ADDRESS as `0x${string}` | undefined;

  if (batcherAddr || proposerAddr) {
    // Use whichever L1 client succeeded
    const activeL1Client = failoverInfo?.triggered
      ? createPublicClient({ chain: getChainPlugin().l1Chain, transport: http(failoverInfo.toUrl, { timeout: RPC_TIMEOUT_MS }) })
      : l1Client;

    try {
      const [batcherBal, proposerBal] = await Promise.all([
        batcherAddr ? activeL1Client.getBalance({ address: batcherAddr }) : Promise.resolve(null),
        proposerAddr ? activeL1Client.getBalance({ address: proposerAddr }) : Promise.resolve(null),
      ]);

      if (batcherBal !== null) batcherBalanceEth = parseFloat(formatEther(batcherBal));
      if (proposerBal !== null) proposerBalanceEth = parseFloat(formatEther(proposerBal));
    } catch {
      // Non-blocking: balance fetch failure doesn't kill the cycle
      console.warn('[AgentLoop] EOA balance fetch failed, continuing');
    }
  }

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

  // Get current vCPU from K8s state (needed for CPU % calculation)
  const currentVcpu = await getCurrentVcpu();

  // CPU usage: prefer real container CPU, fall back to EVM load proxy
  let cpuUsage: number;
  const containerCpu = await getContainerCpuUsage();
  if (containerCpu && currentVcpu > 0) {
    const requestMillicores = currentVcpu * 1000;
    cpuUsage = (containerCpu.cpuMillicores / requestMillicores) * 100;
  } else {
    cpuUsage = gasUsedRatio * 100;
  }

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

  return { dataPoint, l1BlockHeight: Number(l1BlockNumber), failover: failoverInfo, batcherBalanceEth, proposerBalanceEth };
}

// ============================================================
// Scaling Evaluation & Execution
// ============================================================

function clampToValidVcpu(vcpu: number): TargetVcpu {
  if (vcpu >= 8) return 8;
  if (vcpu >= 4) return 4;
  if (vcpu >= 2) return 2;
  return 1;
}

async function evaluateAndExecuteScaling(
  dataPoint: MetricDataPoint
): Promise<AgentCycleResult['scaling']> {
  const autoScaling = await isAutoScalingEnabled();
  // Seed metrics may include synthetic currentVcpu (e.g., 8 in spike scenario).
  // For execution decisions, always use actual runtime vCPU when seed data is active.
  const currentVcpu = dataPoint.seedTtlExpiry
    ? await getCurrentVcpu()
    : (dataPoint.currentVcpu || await getCurrentVcpu());
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
        console.info(`[AgentLoop] Predictive override: ${currentVcpu} → ${finalTarget} vCPU`);
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
  const targetMemoryGiB = (finalTarget * 2) as TargetMemoryGiB;
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

    console.info(`[AgentLoop] Scaling executed: ${scaleResult.previousVcpu} → ${scaleResult.currentVcpu} vCPU`);
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

  console.info('[Agent Loop] Starting cycle...');

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

    const { dataPoint, l1BlockHeight, failover, batcherBalanceEth, proposerBalanceEth } = collected;

    const metricsResult: AgentCycleResult['metrics'] = {
      l1BlockHeight,
      l2BlockHeight: dataPoint.blockHeight,
      cpuUsage: dataPoint.cpuUsage,
      txPoolPending: dataPoint.txPoolPending,
      gasUsedRatio: dataPoint.gasUsedRatio,
      batcherBalanceEth,
      proposerBalanceEth,
    };

    // Phase 1.5: Proxyd backend health check (non-blocking)
    try {
      const replacement = await checkProxydBackends();
      if (replacement) {
        console.info(`[AgentLoop] Proxyd backend replaced: ${replacement.backendName} → ${replacement.newUrl}`);
      }
    } catch {
      // Non-blocking — continue cycle
    }

    // Phase 2: Detect — run anomaly detection pipeline
    const detection = await runDetectionPipeline(dataPoint, {
      batcherBalanceEth,
      proposerBalanceEth,
    });

    // Phase 3+4: Decide & Act — evaluate scaling and auto-execute
    const scaling = await evaluateAndExecuteScaling(dataPoint);

    const result: AgentCycleResult = {
      timestamp,
      phase: 'complete',
      metrics: metricsResult,
      detection,
      scaling,
      failover,
    };
    await pushCycleResult(result);
    console.info(`[Agent Loop] Cycle complete: score=${scaling?.score}, L2=${metricsResult.l2BlockHeight}`);
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AgentLoop] Cycle failed:', errorMsg);
    const result: AgentCycleResult = {
      timestamp,
      phase: 'error',
      metrics: null,
      detection: null,
      scaling: null,
      error: errorMsg,
    };
    await pushCycleResult(result);
    return result;
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

// ============================================================
// Cycle History (Redis-backed for cross-worker persistence)
// ============================================================

async function pushCycleResult(result: AgentCycleResult): Promise<void> {
  const store = getStore();
  await store.pushAgentCycleResult(result);
}

/**
 * Get recent cycle results (newest last)
 */
export async function getAgentCycleHistory(limit?: number): Promise<AgentCycleResult[]> {
  const store = getStore();
  return store.getAgentCycleHistory(limit);
}

/**
 * Get total number of stored cycle results
 */
export async function getAgentCycleCount(): Promise<number> {
  const store = getStore();
  return store.getAgentCycleCount();
}

/**
 * Get the most recent cycle result
 */
export async function getLastCycleResult(): Promise<AgentCycleResult | null> {
  const store = getStore();
  return store.getLastAgentCycleResult();
}
