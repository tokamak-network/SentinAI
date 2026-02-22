/**
 * Agent Loop
 * Autonomous observe-decide-act loop that runs server-side without browser dependency.
 * Collects metrics → detects anomalies → evaluates scaling → auto-executes actions.
 */

import { randomUUID } from 'crypto';
import { createPublicClient, http, formatEther } from 'viem';
import { getChainPlugin } from '@/chains';
import { pushMetric, getRecentMetrics } from '@/lib/metrics-store';
import { getStore } from '@/lib/redis-store';
import { recordUsage } from '@/lib/usage-tracker';
import { runDetectionPipeline, type DetectionResult } from '@/lib/detection-pipeline';
import { getActiveL1RpcUrl, reportL1Success, reportL1Failure, checkProxydBackends, getFailoverEvents } from '@/lib/l1-rpc-failover';
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
import { addAgentMemoryEntry, addDecisionTraceEntry, queryAgentMemory } from '@/lib/agent-memory';
import { verifyOperationOutcome } from '@/lib/operation-verifier';
import { buildRollbackPlan, runRollbackPlan } from '@/lib/rollback-runner';
import { DEFAULT_SCALING_CONFIG, type TargetVcpu, type TargetMemoryGiB, type ScalingDecision } from '@/types/scaling';
import { DEFAULT_PREDICTION_CONFIG } from '@/types/prediction';
import type { MetricDataPoint } from '@/types/prediction';
import type { ScalingMetrics } from '@/types/scaling';
import type { AgentMemoryEntry, AgentPhaseTraceEntry, DecisionTrace, DecisionVerification } from '@/types/agent-memory';

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
  error?: string;
}

// ============================================================
// State
// ============================================================

let running = false;
let lastObservedFailoverTimestamp: string | null = null;


// ============================================================
// Metrics Collection (Server-side, no HTTP overhead)
// ============================================================

interface CollectedMetrics {
  dataPoint: MetricDataPoint;
  l1BlockHeight: number;
  failover?: AgentCycleResult['failover'];
  batcherBalanceEth?: number;
  proposerBalanceEth?: number;
  challengerBalanceEth?: number;
}

async function getRecentSafeMetrics(): Promise<CollectedMetrics | null> {
  const recent = await getRecentMetrics(1);
  if (!recent || recent.length === 0) return null;

  const point = recent[0];
  return {
    dataPoint: {
      ...point,
      timestamp: new Date().toISOString(),
    },
    l1BlockHeight: 0,
  };
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
  let challengerBalanceEth: number | undefined;

  const batcherAddr = process.env.BATCHER_EOA_ADDRESS as `0x${string}` | undefined;
  const proposerAddr = process.env.PROPOSER_EOA_ADDRESS as `0x${string}` | undefined;
  const challengerAddr = process.env.CHALLENGER_EOA_ADDRESS as `0x${string}` | undefined;

  if (batcherAddr || proposerAddr || challengerAddr) {
    // Use whichever L1 client succeeded
    const activeL1Client = failoverInfo?.triggered
      ? createPublicClient({ chain: getChainPlugin().l1Chain, transport: http(failoverInfo.toUrl, { timeout: RPC_TIMEOUT_MS }) })
      : l1Client;

    try {
      const [batcherBal, proposerBal, challengerBal] = await Promise.all([
        batcherAddr ? activeL1Client.getBalance({ address: batcherAddr }) : Promise.resolve(null),
        proposerAddr ? activeL1Client.getBalance({ address: proposerAddr }) : Promise.resolve(null),
        challengerAddr ? activeL1Client.getBalance({ address: challengerAddr }) : Promise.resolve(null),
      ]);

      if (batcherBal !== null) batcherBalanceEth = parseFloat(formatEther(batcherBal));
      if (proposerBal !== null) proposerBalanceEth = parseFloat(formatEther(proposerBal));
      if (challengerBal !== null) challengerBalanceEth = parseFloat(formatEther(challengerBal));
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

  return { dataPoint, l1BlockHeight: Number(l1BlockNumber), failover: failoverInfo, batcherBalanceEth, proposerBalanceEth, challengerBalanceEth };
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

interface ScalingPlan {
  decision: ScalingDecision;
  score: number;
  currentVcpu: number;
  targetVcpu: TargetVcpu;
  reason: string;
  confidence: number;
  autoScalingEnabled: boolean;
  cooldown: { inCooldown: boolean; remainingSeconds: number };
}

function compactHintText(value: string, maxLength: number = 100): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

async function buildScalingPlan(
  dataPoint: MetricDataPoint,
  aiSeverity?: ScalingMetrics['aiSeverity'],
  memoryHint?: string
): Promise<ScalingPlan> {
  const autoScalingEnabled = await isAutoScalingEnabled();
  const cooldown = await checkCooldown();

  // Seed metrics may include synthetic currentVcpu (e.g., 8 in spike scenario).
  // For execution decisions, always use actual runtime vCPU when seed data is active.
  const currentVcpu = dataPoint.seedTtlExpiry
    ? await getCurrentVcpu()
    : (dataPoint.currentVcpu || await getCurrentVcpu());

  const metrics: ScalingMetrics = {
    cpuUsage: dataPoint.cpuUsage,
    txPoolPending: dataPoint.txPoolPending,
    gasUsedRatio: dataPoint.gasUsedRatio,
    aiSeverity,
  };

  const decision = makeScalingDecision(metrics);
  let targetVcpu: TargetVcpu = decision.targetVcpu;
  let reason = decision.reason;
  let confidence = decision.confidence;

  if (memoryHint) {
    reason = `${reason} | Memory: ${compactHintText(memoryHint)}`;
  }

  const metricsHistory = await getRecentMetrics();
  if (metricsHistory.length >= DEFAULT_PREDICTION_CONFIG.minDataPoints) {
    try {
      const prediction = await predictScaling(currentVcpu);
      if (
        prediction &&
        prediction.confidence >= DEFAULT_PREDICTION_CONFIG.confidenceThreshold &&
        prediction.recommendedAction === 'scale_up' &&
        prediction.predictedVcpu > targetVcpu
      ) {
        targetVcpu = clampToValidVcpu(prediction.predictedVcpu);
        reason = `[Predictive] ${prediction.reasoning} (Confidence: ${(prediction.confidence * 100).toFixed(0)}%)`;
        confidence = prediction.confidence;
        console.info(`[AgentLoop] Predictive override: ${currentVcpu} → ${targetVcpu} vCPU`);
      }
    } catch {
      // Prediction failure is non-fatal
    }
  }

  return {
    decision,
    score: decision.score,
    currentVcpu,
    targetVcpu,
    reason,
    confidence,
    autoScalingEnabled,
    cooldown,
  };
}

async function executeScalingPlan(plan: ScalingPlan): Promise<AgentCycleResult['scaling']> {
  const result: NonNullable<AgentCycleResult['scaling']> = {
    score: plan.score,
    currentVcpu: plan.currentVcpu,
    targetVcpu: plan.targetVcpu as number,
    executed: false,
    reason: plan.reason,
    confidence: plan.confidence,
  };

  if (!plan.autoScalingEnabled) {
    result.reason = `[Skip] Auto-scaling disabled. ${result.reason}`;
    return result;
  }

  if (plan.cooldown.inCooldown) {
    result.reason = `[Skip] Cooldown ${plan.cooldown.remainingSeconds}s. ${result.reason}`;
    return result;
  }

  if (plan.targetVcpu === plan.currentVcpu) {
    result.reason = `[Skip] Already at ${plan.currentVcpu} vCPU. ${result.reason}`;
    return result;
  }

  const targetMemoryGiB = (plan.targetVcpu * 2) as TargetMemoryGiB;
  const scaleResult = await scaleOpGeth(plan.targetVcpu, targetMemoryGiB, DEFAULT_SCALING_CONFIG);

  if (scaleResult.success && scaleResult.previousVcpu !== scaleResult.currentVcpu) {
    result.executed = true;
    result.reason = `[Executed] ${scaleResult.previousVcpu} → ${scaleResult.currentVcpu} vCPU. ${result.reason}`;

    await addScalingHistory({
      timestamp: scaleResult.timestamp,
      fromVcpu: scaleResult.previousVcpu,
      toVcpu: scaleResult.currentVcpu,
      reason: plan.reason,
      triggeredBy: 'auto',
      decision: plan.decision,
    });

    await addScalingEvent({
      timestamp: scaleResult.timestamp,
      fromVcpu: scaleResult.previousVcpu,
      toVcpu: scaleResult.currentVcpu,
      trigger: 'auto',
      reason: plan.reason,
    });

    console.info(`[AgentLoop] Scaling executed: ${scaleResult.previousVcpu} → ${scaleResult.currentVcpu} vCPU`);
  }

  return result;
}

async function verifyScalingOutcome(
  scaling: AgentCycleResult['scaling']
): Promise<DecisionVerification> {
  if (!scaling) {
    return {
      expected: 'no-scaling-decision',
      observed: 'no-scaling-decision',
      passed: true,
      details: 'Scaling decision was not generated',
    };
  }

  if (!scaling.executed) {
    return {
      expected: `no-op at ${scaling.currentVcpu} vCPU`,
      observed: `no-op at ${scaling.currentVcpu} vCPU`,
      passed: true,
      details: 'No scaling execution was required',
    };
  }

  const verification = await verifyOperationOutcome({
    actionType: 'agent_scaling',
    dryRun: false,
    expected: { targetVcpu: scaling.targetVcpu },
    observed: { currentVcpu: await getCurrentVcpu() },
  });

  if (verification.passed) {
    return {
      expected: `${scaling.targetVcpu} vCPU`,
      observed: verification.observed,
      passed: true,
      details: verification.details || 'Target vCPU applied successfully',
    };
  }

  const rollbackPlan = buildRollbackPlan({
    actionType: 'agent_scaling',
    execution: {
      previousVcpu: scaling.currentVcpu,
      currentVcpu: scaling.targetVcpu,
    },
  });
  const rollback = await runRollbackPlan(rollbackPlan, false);

  if (rollback.success) {
    return {
      expected: `${scaling.targetVcpu} vCPU`,
      observed: `${scaling.currentVcpu} vCPU (rolled back)`,
      passed: true,
      details: `Verification failed (${verification.details || 'unknown'}), rollback succeeded (${rollback.message})`,
    };
  }

  return {
    expected: `${scaling.targetVcpu} vCPU`,
    observed: verification.observed,
    passed: false,
    details: `Verification failed (${verification.details || 'unknown'}) and rollback failed (${rollback.message})`,
  };
}

// ============================================================
// Main Agent Cycle
// ============================================================

/**
 * Run one agent cycle: observe → detect → analyze → plan → act → verify
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
  const decisionId = randomUUID();
  const phaseTrace: AgentPhaseTraceEntry[] = [];
  const degradedReasons: string[] = [];

  console.info('[Agent Loop] Starting cycle...');

  const beginPhase = (
    phase: AgentPhaseTraceEntry['phase']
  ): { phase: AgentPhaseTraceEntry['phase']; startedAt: string } => ({
    phase,
    startedAt: new Date().toISOString(),
  });

  const endPhase = (
    started: { phase: AgentPhaseTraceEntry['phase']; startedAt: string },
    ok: boolean,
    error?: string
  ): void => {
    phaseTrace.push({
      phase: started.phase,
      startedAt: started.startedAt,
      endedAt: new Date().toISOString(),
      ok,
      error,
    });
  };

  try {
    // Phase 1: Observe — collect metrics from RPC
    const observePhase = beginPhase('observe');
    let collected: CollectedMetrics | null = null;
    let observeError: string | null = null;
    try {
      collected = await collectMetrics();
    } catch (error) {
      observeError = error instanceof Error ? error.message : 'Unknown error';
    }

    if (!collected) {
      const fallbackMetrics = await getRecentSafeMetrics();
      if (!fallbackMetrics) {
        const message = observeError || 'Metrics collection failed (L2_RPC_URL not configured)';
        endPhase(observePhase, false, message);
        return {
          timestamp,
          phase: 'error',
          decisionId,
          phaseTrace,
          metrics: null,
          detection: null,
          scaling: null,
          error: message,
        };
      }

      collected = fallbackMetrics;
      degradedReasons.push('observe-fallback:last-safe-metrics');
      const fallbackMessage = observeError
        ? `Observe degraded: ${observeError} (using last safe metrics)`
        : 'Observe degraded: using last safe metrics';
      endPhase(observePhase, false, fallbackMessage);
    } else {
      endPhase(observePhase, true);
    }

    const { dataPoint, l1BlockHeight, failover, batcherBalanceEth, proposerBalanceEth, challengerBalanceEth } = collected;
    let failoverInfo = failover;
    let proxydReplacement: AgentCycleResult['proxydReplacement'] | undefined;

    const metricsResult: AgentCycleResult['metrics'] = {
      l1BlockHeight,
      l2BlockHeight: dataPoint.blockHeight,
      cpuUsage: dataPoint.cpuUsage,
      txPoolPending: dataPoint.txPoolPending,
      gasUsedRatio: dataPoint.gasUsedRatio,
      batcherBalanceEth,
      proposerBalanceEth,
      challengerBalanceEth,
    };

    // Phase 1.5: Proxyd backend health check (non-blocking)
    try {
      const replacement = await checkProxydBackends();
      if (replacement) {
        console.info(`[AgentLoop] Proxyd backend replaced: ${replacement.backendName} → ${replacement.newUrl}`);
        proxydReplacement = {
          triggered: true,
          backendName: replacement.backendName,
          oldUrl: replacement.oldUrl,
          newUrl: replacement.newUrl,
          reason: replacement.reason,
        };
      }
    } catch {
      // Non-blocking — continue cycle
    }

    // Include non-Proxyd L1 URL failovers even when they were triggered outside this cycle path.
    const latestFailoverEvent = getLatestUnseenFailoverEvent(failoverInfo);
    if (!failoverInfo && latestFailoverEvent) {
      failoverInfo = {
        triggered: true,
        fromUrl: latestFailoverEvent.fromUrl,
        toUrl: latestFailoverEvent.toUrl,
        k8sUpdated: latestFailoverEvent.k8sUpdated,
      };
    }

    // Phase 2: Detect — run anomaly detection pipeline
    const detectPhase = beginPhase('detect');
    const detection = await runDetectionPipeline(dataPoint, {
      batcherBalanceEth,
      proposerBalanceEth,
      challengerBalanceEth,
    });
    endPhase(detectPhase, true);

    // Phase 3: Analyze — AI severity extraction (best effort)
    const analyzePhase = beginPhase('analyze');
    let aiSeverity: ScalingMetrics['aiSeverity'];
    try {
      const logs = await getAllLiveLogs();
      const aiResult = await analyzeLogChunk(logs);
      aiSeverity = mapAIResultToSeverity(aiResult ? { severity: aiResult.severity } : null);
      endPhase(analyzePhase, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      aiSeverity = undefined;
      endPhase(analyzePhase, false, message);
    }

    // Phase 4: Plan — build scaling plan
    const planPhase = beginPhase('plan');
    let memoryHint: string | undefined;
    try {
      const memoryEntries = await queryAgentMemory({
        limit: 1,
        component: getChainPlugin().primaryExecutionClient,
      });
      const latest = memoryEntries[0];
      if (latest?.summary) {
        memoryHint = latest.summary;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn('[AgentLoop] Memory retrieval failed during planning:', message);
      degradedReasons.push('plan-memory-retrieval-failed');
    }

    const scalingPlan = await buildScalingPlan(dataPoint, aiSeverity, memoryHint);
    endPhase(planPhase, true);

    // Phase 5: Act — execute scaling plan
    const actPhase = beginPhase('act');
    let scaling: AgentCycleResult['scaling'];
    try {
      scaling = await executeScalingPlan(scalingPlan);
      endPhase(actPhase, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      degradedReasons.push(`act-failed:${message}`);
      scaling = {
        score: scalingPlan.score,
        currentVcpu: scalingPlan.currentVcpu,
        targetVcpu: scalingPlan.currentVcpu,
        executed: false,
        reason: `[Degraded] Action failed (${message}). Fallback to no-op. ${scalingPlan.reason}`,
        confidence: scalingPlan.confidence,
      };
      endPhase(actPhase, false, message);
    }

    // Phase 6: Verify — verify action outcome
    const verifyPhase = beginPhase('verify');
    const verification = await verifyScalingOutcome(scaling);
    endPhase(verifyPhase, verification.passed, verification.passed ? undefined : verification.details);

    const result: AgentCycleResult = {
      timestamp,
      phase: 'complete',
      decisionId,
      phaseTrace,
      verification,
      degraded: degradedReasons.length > 0 ? { active: true, reasons: degradedReasons } : undefined,
      metrics: metricsResult,
      detection,
      scaling,
      failover: failoverInfo,
      proxydReplacement,
    };
    await pushCycleResult(result);
    await persistDecisionArtifacts(result);
    console.info(`[Agent Loop] Cycle complete: score=${scaling?.score}, L2=${dataPoint.blockHeight}`);
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AgentLoop] Cycle failed:', errorMsg);
    const result: AgentCycleResult = {
      timestamp,
      phase: 'error',
      decisionId,
      phaseTrace,
      degraded: degradedReasons.length > 0 ? { active: true, reasons: degradedReasons } : undefined,
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
  lastObservedFailoverTimestamp = null;
}

function getLatestUnseenFailoverEvent(
  currentCycleFailover?: AgentCycleResult['failover']
): ReturnType<typeof getFailoverEvents>[number] | null {
  const events = getFailoverEvents();
  if (events.length === 0) return null;

  const latest = events[events.length - 1];
  if (!latest) return null;

  // If this cycle already captured a failover, mark it as observed and don't override.
  if (currentCycleFailover?.triggered) {
    lastObservedFailoverTimestamp = latest.timestamp;
    return null;
  }

  // Bootstrap: don't replay stale history on first observation.
  if (lastObservedFailoverTimestamp === null) {
    lastObservedFailoverTimestamp = latest.timestamp;
    return null;
  }

  if (latest.timestamp === lastObservedFailoverTimestamp) {
    return null;
  }

  lastObservedFailoverTimestamp = latest.timestamp;
  return latest;
}

async function persistDecisionArtifacts(result: AgentCycleResult): Promise<void> {
  if (!result.decisionId || !result.scaling || !result.verification) return;

  const chainType = process.env.CHAIN_TYPE || 'thanos';
  const anomalyCount = result.detection?.anomalies?.filter((item) => item.isAnomaly).length ?? 0;
  const primaryComponent = getChainPlugin().primaryExecutionClient;
  const inferredSeverity =
    result.scaling.score >= 90
      ? 'critical'
      : result.scaling.score >= 70
        ? 'high'
        : result.scaling.score >= 40
          ? 'medium'
          : 'low';

  const trace: DecisionTrace = {
    decisionId: result.decisionId,
    timestamp: result.timestamp,
    chainType,
    severity: inferredSeverity,
    inputs: {
      anomalyCount,
      metrics: result.metrics
        ? {
            l1BlockHeight: result.metrics.l1BlockHeight,
            l2BlockHeight: result.metrics.l2BlockHeight,
            cpuUsage: result.metrics.cpuUsage,
            txPoolPending: result.metrics.txPoolPending,
            gasUsedRatio: result.metrics.gasUsedRatio,
          }
        : null,
      scalingScore: result.scaling.score,
    },
    reasoningSummary: result.scaling.reason,
    evidence: [
      {
        type: 'metric',
        key: 'cpuUsage',
        value: result.metrics ? `${result.metrics.cpuUsage.toFixed(3)}%` : 'N/A',
        source: 'agent-loop',
      },
      {
        type: 'metric',
        key: 'txPoolPending',
        value: result.metrics ? `${result.metrics.txPoolPending}` : 'N/A',
        source: 'agent-loop',
      },
      {
        type: 'anomaly',
        key: 'anomalyCount',
        value: `${anomalyCount}`,
        source: 'detection-pipeline',
      },
    ],
    chosenAction: result.scaling.executed
      ? `scale_to_${result.scaling.targetVcpu}`
      : `noop_at_${result.scaling.currentVcpu}`,
    alternatives: [`keep_${result.scaling.currentVcpu}`],
    phaseTrace: result.phaseTrace || [],
    verification: result.verification,
  };

  const memoryEntry: AgentMemoryEntry = {
    id: randomUUID(),
    timestamp: result.timestamp,
    category: result.scaling.executed ? 'scaling' : 'analysis',
    chainType,
    summary: result.scaling.reason,
    decisionId: result.decisionId,
    component: primaryComponent,
    severity: inferredSeverity,
    metadata: {
      score: result.scaling.score,
      currentVcpu: result.scaling.currentVcpu,
      targetVcpu: result.scaling.targetVcpu,
      executed: result.scaling.executed,
      verificationPassed: result.verification.passed,
      degraded: result.degraded?.active ?? false,
      degradedReasons: result.degraded?.reasons ?? [],
    },
  };

  try {
    await addDecisionTraceEntry(trace);
    await addAgentMemoryEntry(memoryEntry);

    if (result.failover?.triggered) {
      await addAgentMemoryEntry({
        id: randomUUID(),
        timestamp: result.timestamp,
        category: 'failover',
        chainType,
        summary: `L1 RPC failover: ${result.failover.fromUrl} -> ${result.failover.toUrl}`,
        decisionId: result.decisionId,
        component: 'l1-rpc',
        severity: 'high',
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[AgentLoop] Failed to persist decision artifacts:', message);
  }
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
