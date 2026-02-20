import { createPublicClient, formatEther, http } from 'viem';
import { getChainPlugin } from '@/chains';
import { NextResponse } from 'next/server';
import { recordUsage } from '@/lib/usage-tracker';
import { getCachedL1BlockNumber } from '@/lib/l1-rpc-cache';
import { getCurrentVcpu } from '@/lib/seed-vcpu-manager';

// Disable Next.js caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { pushMetric, getRecentMetrics } from '@/lib/metrics-store';
import { MetricDataPoint } from '@/types/prediction';
import { runK8sCommand, getNamespace, getAppPrefix } from '@/lib/k8s-config';
import { getStore } from '@/lib/redis-store';
import { runDetectionPipeline } from '@/lib/detection-pipeline';
import { getContainerCpuUsage, getAllContainerUsage, getAllContainerUsageViaKubelet } from '@/lib/k8s-scaler';
import { isDockerMode } from '@/lib/docker-config';
import { getDockerComponentDetails } from '@/lib/docker-orchestrator';
import { getActiveL1RpcUrl, getL2NodesL1RpcStatus } from '@/lib/l1-rpc-failover';
import { getAllBalanceStatus } from '@/lib/eoa-balance-monitor';
import { getDisputeGameMonitor } from '@/lib/dispute-game-monitor';
import { checkDerivationLag, isL1Healthy } from '@/lib/derivation-lag-monitor';
import { resolveBlockInterval } from '@/lib/block-interval';
import type { AnomalyResult } from '@/types/anomaly';

// Whether anomaly detection is enabled (default: enabled)
const ANOMALY_DETECTION_ENABLED = process.env.ANOMALY_DETECTION_ENABLED !== 'false';
const RPC_TIMEOUT_MS = 15_000;

// Block interval tracking moved to state store (Redis or InMemory)

interface ComponentDetail {
    name: string;
    type: string;
    strategy: string;
    current: string;
    status: string;
    icon: string;
    rawCpu: number;
    nodeName?: string;
    metrics?: {
        cpuReq: string;
        memReq: string;
        node: string;
    };
    usage?: {
        cpuPercent: number;
        memoryMiB: number;
    };
}

/** Map display names to K8s component suffixes for usage matching */
const COMPONENT_SUFFIX_MAP: Record<string, string> = {
    'L2 Client': 'op-geth',
    'Consensus Node': 'op-node',
    'Batcher': 'op-batcher',
    'Proposer': 'op-proposer',
    'Challenger': 'op-challenger',
};

async function getDisputeGameStatus(l1RpcUrl: string) {
    const enabled = process.env.FAULT_PROOF_ENABLED === 'true';
    if (!enabled) {
        return {
            enabled: false,
            activeGames: 0,
            gamesNearDeadline: 0,
            claimableBonds: 0,
            totalBondsLockedEth: 0,
            challengerConfigured: false,
            factoryConfigured: false,
            lastCheckedAt: new Date().toISOString(),
        };
    }

    try {
        const factoryAddress = process.env.DISPUTE_GAME_FACTORY_ADDRESS as `0x${string}` | undefined;
        const challengerAddress = process.env.CHALLENGER_EOA_ADDRESS as `0x${string}` | undefined;
        const monitor = getDisputeGameMonitor(
            getChainPlugin().l1Chain,
            l1RpcUrl,
            factoryAddress,
            challengerAddress
        );

        const [stats, deadlineAlerts, claimableAlerts] = await Promise.all([
            monitor.getStatistics(),
            monitor.checkDeadlines(24),
            monitor.checkClaimableBonds(),
        ]);

        return {
            enabled: true,
            activeGames: stats.activeGames,
            gamesNearDeadline: deadlineAlerts.length > 0
                ? deadlineAlerts.length
                : stats.gamesNearDeadline,
            claimableBonds: claimableAlerts.length,
            totalBondsLockedEth: Number(formatEther(stats.totalBondsLocked)),
            challengerConfigured: Boolean(challengerAddress),
            factoryConfigured: Boolean(factoryAddress),
            lastCheckedAt: new Date().toISOString(),
        };
    } catch (error) {
        console.warn('[Metrics API] Failed to fetch dispute game status:', error instanceof Error ? error.message : error);
        return {
            enabled: true,
            activeGames: 0,
            gamesNearDeadline: 0,
            claimableBonds: 0,
            totalBondsLockedEth: 0,
            challengerConfigured: Boolean(process.env.CHALLENGER_EOA_ADDRESS),
            factoryConfigured: Boolean(process.env.DISPUTE_GAME_FACTORY_ADDRESS),
            lastCheckedAt: new Date().toISOString(),
            error: 'failed-to-fetch',
        };
    }
}

// Fetch deep details for a specific component
async function getComponentDetails(labelSelector: string, displayName: string, icon: string, strategy: string = "Static"): Promise<ComponentDetail | null> {
    const namespace = getNamespace();
    try {
        // 1. Get Pod Info (JSON)
        const podCmd = `get pods -n ${namespace} -l ${labelSelector} -o json`;
        const { stdout: podOut } = await runK8sCommand(podCmd);

        if (!podOut) return null;
        const podData = JSON.parse(podOut);

        if (!podData.items || podData.items.length === 0) {
            return {
                name: displayName,
                type: "Stateless",
                strategy,
                current: "Not Found",
                status: "Stopped",
                icon,
                rawCpu: 0
            };
        }

        const pod = podData.items[0]; // Assume single replica for now
        const containers = pod.spec.containers;
        // Check requests or limits
        const resourceReq = containers[0]?.resources?.requests || {};

        // vCPU Logic
        let cpuDisp = "0.0 vCPU";
        let rawCpu = 0;
        if (resourceReq.cpu) {
            if (resourceReq.cpu.includes('m')) {
                rawCpu = parseFloat(resourceReq.cpu) / 1000;
            } else {
                rawCpu = parseFloat(resourceReq.cpu);
            }
            cpuDisp = `${rawCpu.toFixed(1)} vCPU`;
        }

        // Memory Logic
        let memDisp = resourceReq.memory || "Unknown";

        // Node & Instance Type Logic
        const nodeName = pod.spec.nodeName;
        let instanceInfo = "Unknown Node";
        let isFargate = false;

        if (nodeName && /^[a-zA-Z0-9._-]+$/.test(nodeName)) {
            try {
                // Check Node for Fargate or Instance Type
                const nodeCmd = `get node ${nodeName} -o json`;
                const { stdout: nodeOut } = await runK8sCommand(nodeCmd);
                const nodeData = JSON.parse(nodeOut);
                const labels = nodeData.metadata.labels || {};

                // Prioritize Fargate check
                if (labels['eks.amazonaws.com/compute-type'] === 'fargate') {
                    instanceInfo = "AWS Fargate";
                    isFargate = true;
                } else if (labels['node.kubernetes.io/instance-type']) {
                    instanceInfo = labels['node.kubernetes.io/instance-type'];
                } else {
                    instanceInfo = "Standard Node";
                }
            } catch {
                instanceInfo = "Node Access Denied";
            }
        }

        // Apply Defaults for Fargate if missing
        if (isFargate) {
            if (rawCpu === 0) {
                rawCpu = 0.25;
                cpuDisp = "0.25 vCPU";
            }
            if (memDisp === "Unknown") {
                memDisp = "512Mi";
            }
        }

        const phase = pod.status.phase;
        const isReady = pod.status.conditions?.find((c: { type: string; status: string }) => c.type === 'Ready')?.status === 'True';
        const statusDisp = isReady ? "Running" : phase;

        const currentDesc = isFargate
            ? `Fargate (${cpuDisp} / ${memDisp})`
            : `${instanceInfo} (${cpuDisp} / ${memDisp})`;

        return {
            name: displayName,
            type: "Stateful", // simplified for UI
            strategy,
            current: currentDesc,
            status: statusDisp,
            icon,
            rawCpu,
            nodeName,
            metrics: {
                cpuReq: cpuDisp,
                memReq: memDisp,
                node: nodeName
            }
        };

    } catch (e) {
        // Only log detailed errors if DEBUG_K8S is enabled
        if (process.env.DEBUG_K8S === 'true') {
            console.error(`Failed to fetch ${displayName}:`, e);
        }
        return {
            name: displayName,
            type: "Unknown",
            strategy,
            current: "Error Fetching",
            status: "Error",
            icon,
            rawCpu: 0
        };
    }
}

// --- Main Handler ---

export async function GET(request: Request) {
    // 0. Simulation Mode Check (Fast Path) - Bypass real K8s/RPC calls for instant feedback
    const url = new URL(request.url);
    const isStressTest = url.searchParams.get('stress') === 'true';

    if (isStressTest) {
        // Cost Constants
        const FARGATE_VCPU_HOUR = 0.04656;
        const FARGATE_MEM_GB_HOUR = 0.00511;
        const HOURS_PER_MONTH = 730;

        // Simulated Resource Usage (Scaling Up)
        const currentVcpu = 8;
        const memoryGiB = 16;

        // Cost Calculations
        const opGethMonthlyCost = (currentVcpu * FARGATE_VCPU_HOUR + memoryGiB * FARGATE_MEM_GB_HOUR) * HOURS_PER_MONTH;
        const fixedCost = (4 * FARGATE_VCPU_HOUR + 8 * FARGATE_MEM_GB_HOUR) * HOURS_PER_MONTH;
        const currentSaving = fixedCost - opGethMonthlyCost;

        // Dynamic Scaler Baseline Estimates
        const avgVcpu = 1.5;
        const avgMemory = 3;
        const dynamicMonthlyCost = (avgVcpu * FARGATE_VCPU_HOUR + avgMemory * FARGATE_MEM_GB_HOUR) * HOURS_PER_MONTH;
        const maxMonthlySaving = fixedCost - dynamicMonthlyCost;
        const currentHourlyCost = opGethMonthlyCost / HOURS_PER_MONTH;

        // Fetch real L1/L2 block heights even in stress mode
        let realL1Block = 0;
        let realL2Block = 0;
        try {
            const rpcUrl = process.env.L2_RPC_URL;
            const l1RpcUrl = getActiveL1RpcUrl();
            if (rpcUrl) {
                const l2Client = createPublicClient({ chain: getChainPlugin().l2Chain, transport: http(rpcUrl) });
                const l1Client = createPublicClient({ chain: getChainPlugin().l1Chain, transport: http(l1RpcUrl) });
                const [l2Block, l1Block] = await Promise.all([
                    l2Client.getBlockNumber(),
                    getCachedL1BlockNumber(() => l1Client.getBlockNumber()),
                ]);
                realL2Block = Number(l2Block);
                realL1Block = Number(l1Block);
            }
        } catch {
            // Fallback to time-based simulation if RPC fails
            const now = Date.now();
            realL1Block = 12500000 + Math.floor(now / 12000) % 10000;
            realL2Block = 6200000 + Math.floor(now / 2000) % 10000;
        }

        return NextResponse.json({
            timestamp: new Date().toISOString(),
            stressMode: true,
            metrics: {
                l1BlockHeight: realL1Block,
                blockHeight: realL2Block,
                txPoolCount: 5021 + Math.floor(Math.random() * 50), // Jitter
                cpuUsage: 96.5 + (Math.random() * 2), // High CPU jitter
                memoryUsage: memoryGiB * 1024,
                gethVcpu: 8,
                gethMemGiB: 16,
                syncLag: 0,
                source: "SIMULATED_FAST_PATH"
            },
            components: [
                {
                    name: "L2 Client", type: "Stateful", strategy: "cpu",
                    current: "Fargate (8.0 vCPU / 16Gi) • Scaling Up",
                    status: "Scaling Up", icon: "cpu", rawCpu: 8,
                    metrics: { cpuReq: "8.0 vCPU", memReq: "16Gi", node: "fargate-sim-ap-ne-2" }
                },
                {
                    name: "Consensus Node", type: "Stateful", strategy: "globe",
                    current: "Running (Standard Node)", status: "Running", icon: "globe", rawCpu: 2,
                    metrics: { cpuReq: "2.0 vCPU", memReq: "4Gi", node: "ip-10-0-1-50.ap-northeast-2" }
                },
                {
                    name: "Batcher", type: "Stateful", strategy: "shuffle",
                    current: "Running (Standard Node)", status: "Running", icon: "shuffle", rawCpu: 1,
                    metrics: { cpuReq: "1.0 vCPU", memReq: "2Gi", node: "ip-10-0-1-51.ap-northeast-2" }
                },
                {
                    name: "Proposer", type: "Stateful", strategy: "shield",
                    current: "Running (Standard Node)", status: "Running", icon: "shield", rawCpu: 0.5,
                    metrics: { cpuReq: "0.5 vCPU", memReq: "1Gi", node: "ip-10-0-1-52.ap-northeast-2" }
                },
                {
                    name: "Challenger", type: "Stateful", strategy: "sword",
                    current: "Running (Standard Node)", status: "Running", icon: "sword", rawCpu: 0.5,
                    metrics: { cpuReq: "0.5 vCPU", memReq: "1Gi", node: "ip-10-0-1-53.ap-northeast-2" }
                }
            ],
            cost: {
                hourlyRate: Number(currentHourlyCost.toFixed(3)),
                opGethMonthlyCost: Number(opGethMonthlyCost.toFixed(2)),
                currentSaving: Number(currentSaving.toFixed(2)),
                dynamicMonthlyCost: Number(dynamicMonthlyCost.toFixed(2)),
                maxMonthlySaving: Number(maxMonthlySaving.toFixed(2)),
                fixedCost: Number(fixedCost.toFixed(2)),
                isPeakMode: true,
                monthlyEstimated: Number(opGethMonthlyCost.toFixed(2)),
                monthlySaving: Number(currentSaving.toFixed(2)),
            },
            status: "healthy",
            derivationLag: {
                available: false,
                lag: null,
                level: 'unknown',
                currentL1: null,
                headL1: null,
                unsafeL2: null,
                safeL2: null,
                finalizedL2: null,
                checkedAt: new Date().toISOString(),
                l1Healthy: null,
                l1ResponseTimeMs: null,
            },
            disputeGames: await getDisputeGameStatus(getActiveL1RpcUrl())
        }, {
            headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
        });
    }
    // Debug: Log incoming request URL
    console.info('[API] Request URL:', request.url);
    const startTotal = performance.now();

    try {
        // 1. Parallel Data Fetch for All Components
        const appPrefix = getAppPrefix();

        const startK8s = performance.now();
        const dockerMode = isDockerMode();
        const fetchDetails = (label: string, service: string, display: string, icon: string, strategy: string = "") =>
            dockerMode
                ? getDockerComponentDetails(service, display, icon, strategy)
                : getComponentDetails(label, display, icon, strategy);

        const [l2Client, consensus, batcher, proposer, challenger, containerUsage, allUsage] = await Promise.all([
            fetchDetails(`app=${appPrefix}-geth`, "op-geth", "L2 Client", "cpu", ""),
            fetchDetails(`app=${appPrefix}-node`, "op-node", "Consensus Node", "globe", ""),
            fetchDetails(`app=${appPrefix}-batcher`, "op-batcher", "Batcher", "shuffle", ""),
            fetchDetails(`app=${appPrefix}-proposer`, "op-proposer", "Proposer", "shield", ""),
            fetchDetails(`app=${appPrefix}-challenger`, "op-challenger", "Challenger", "sword", ""),
            getContainerCpuUsage(),
            getAllContainerUsage(),
        ]);
        console.info(`[Timer] K8s Fetch: ${(performance.now() - startK8s).toFixed(2)}ms`);

        const components = [l2Client, consensus, batcher, proposer, challenger];

        // Fallback: kubelet proxy when metrics-server is unavailable
        let resolvedUsage = allUsage;
        if (!resolvedUsage) {
            const nodeMap = new Map<string, string>();
            for (const comp of components) {
                if (!comp) continue;
                const suffix = COMPONENT_SUFFIX_MAP[comp.name];
                if (suffix && comp.nodeName) nodeMap.set(suffix, comp.nodeName);
            }
            if (nodeMap.size > 0) {
                resolvedUsage = await getAllContainerUsageViaKubelet(nodeMap);
            }
        }

        // Inject real CPU/memory usage into each component
        if (resolvedUsage) {
            for (const comp of components) {
                if (!comp) continue;
                const suffix = COMPONENT_SUFFIX_MAP[comp.name];
                if (!suffix) continue;
                const usage = resolvedUsage.get(suffix);
                if (usage && comp.rawCpu > 0) {
                    comp.usage = {
                        cpuPercent: (usage.cpuMillicores / (comp.rawCpu * 1000)) * 100,
                        memoryMiB: usage.memoryMiB,
                    };
                }
            }
        }

        // 2. Metrics (Chain Data)
        const startRpc = performance.now();
        const rpcUrl = process.env.L2_RPC_URL;
        if (!rpcUrl) {
            return NextResponse.json(
                { error: "L2_RPC_URL environment variable is required" },
                { status: 500 }
            );
        }
        const l1RpcUrl = getActiveL1RpcUrl();

        const l2RpcClient = createPublicClient({ chain: getChainPlugin().l2Chain, transport: http(rpcUrl) });
        const l1RpcClient = createPublicClient({ chain: getChainPlugin().l1Chain, transport: http(l1RpcUrl) });

        // Fetch L2 block details and L1 block number in parallel (1 less RPC call)
        const [block, l1BlockNumber, derivationLagStatus, l1HealthStatus] = await Promise.all([
            l2RpcClient.getBlock({ blockTag: 'latest' }),
            getCachedL1BlockNumber(() => l1RpcClient.getBlockNumber()),
            checkDerivationLag(rpcUrl),
            isL1Healthy(l1RpcUrl, getChainPlugin().l1Chain),
        ]);
        const blockNumber = block.number;

        // Get actual TxPool pending count via txpool_status RPC
        let txPoolPending = 0;
        let txPoolTimeoutId: ReturnType<typeof setTimeout> | null = null;
        try {
            const controller = new AbortController();
            txPoolTimeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
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
            const txPoolData = await txPoolResponse.json();
            if (txPoolData.result?.pending) {
                txPoolPending = parseInt(txPoolData.result.pending, 16);
            }
        } catch {
            // Fallback: use current block tx count if txpool_status not supported
            txPoolPending = block.transactions.length;
        } finally {
            if (txPoolTimeoutId) {
                clearTimeout(txPoolTimeoutId);
            }
        }
        console.info(`[Timer] RPC Fetch: ${(performance.now() - startRpc).toFixed(2)}ms`);

        // 3. Check if seed scenario is active - use stored metrics if so
        // Get seed scenario from state store (cross-worker persistence)
        const activeScenario = await getStore().getSeedScenario();
        let usingSeedMetrics = false;
        let seedMetricData: Awaited<ReturnType<typeof getRecentMetrics>>[0] | null = null;

        // Only enter seed path when an active seed scenario exists (not 'live')
        if (activeScenario && activeScenario !== 'live') {
            console.info(`[Metrics API] activeScenario from state store: ${activeScenario}`);
            const recentMetrics = await getRecentMetrics();
            if (recentMetrics && recentMetrics.length > 0) {
                const latestMetric = recentMetrics[recentMetrics.length - 1];
                if (latestMetric && latestMetric.cpuUsage !== undefined) {
                    seedMetricData = latestMetric;
                    usingSeedMetrics = true;
                    console.info(`[Metrics API] Using seed metrics from store (scenario: ${activeScenario})`);
                }
            }
        }

        // 4. Metrics (Host Resource - Best Effort) or Seed Data
        let cpuSource: 'container' | 'evm_load' | 'seed' = 'evm_load';
        let realCpu = 0;
        let effectiveTx = txPoolPending;
        let gasUsedRatio = 0;
        let blockInterval = 2.0;

        if (usingSeedMetrics && seedMetricData) {
            // Use seed metrics
            realCpu = seedMetricData.cpuUsage;
            effectiveTx = seedMetricData.txPoolPending;
            gasUsedRatio = seedMetricData.gasUsedRatio;
            blockInterval = seedMetricData.blockInterval;
            cpuSource = 'seed';
            console.info(`[Metrics API] Using seed CPU=${realCpu.toFixed(1)}%, txPool=${effectiveTx}`);
        } else {
            // Use real K8s metrics
            const gasUsed = Number(block.gasUsed);
            const gasLimit = Number(block.gasLimit);
            const evmLoad = (gasUsed / gasLimit) * 100;
            gasUsedRatio = gasUsed / gasLimit;

            // Use real container CPU if available, otherwise fallback to EVM load
            realCpu = evmLoad;
            if (containerUsage) {
                const requestMillicores = (l2Client?.rawCpu || 1) * 1000;
                realCpu = (containerUsage.cpuMillicores / requestMillicores) * 100;
                cpuSource = 'container';
            }
        }

        // 5. Simulation & Stress Mode
        const url = new URL(request.url);
        const isStressTest = url.searchParams.get('stress') === 'true';

        let effectiveCpu = realCpu;
        let currentVcpu: number = l2Client ? (l2Client.rawCpu || 1) : 1;

        // Apply seed scenario vCPU progression if active (before stress mode)
        // Use seed data's vCPU directly (works across worker threads)
        if (usingSeedMetrics && seedMetricData && seedMetricData.currentVcpu) {
            console.info(`[Metrics API] Using seed data vCPU = ${seedMetricData.currentVcpu}`);
            currentVcpu = seedMetricData.currentVcpu;
        } else if (activeScenario && activeScenario !== 'live') {
            // Fallback: try to get vCPU from in-memory profile if seed data unavailable
            const seedVcpu = getCurrentVcpu();
            console.info(`[Metrics API] Seed scenario active (${activeScenario}): using vCPU = ${seedVcpu}`);
            currentVcpu = seedVcpu;
        } else if (!activeScenario || activeScenario === 'live') {
            console.info(`[Metrics API] No active seed scenario, using K8s vCPU = ${currentVcpu}`);
        }

        if (isStressTest) {
            effectiveCpu = 96.5; // Simulate overload
            currentVcpu = 8;     // Simulate scaling up to max (8 vCPU / 16 GiB)

            // Update L2 Client component display to reflect simulation
            if (components[0]) {
                components[0].current = `Fargate (8.0 vCPU / 16Gi) • Scaling Up`;
                components[0].status = "Scaling Up";
                // We don't change rawCpu here to keep cost calcs demonstrating the *projected* cost
            }
        }

        // 5. Cost Calculation (Dynamic Scaler - op-geth Fargate cost only)
        // Ref: docs/phase0-dynamic-scaler-savings.md
        //
        // Fargate Pricing (Seoul): $0.04656/vCPU-hour, $0.00511/GB-hour
        // op-geth Memory: vCPU × 2 GiB
        //
        // Cost Scenario:
        // - 4 vCPU Fixed (Legacy): $362/month
        // - Dynamic (1-4 vCPU): $64/month (70% idle, 20% normal, 10% peak)
        // - Saving: ~$300/month

        const FARGATE_VCPU_HOUR = 0.04656;
        const FARGATE_MEM_GB_HOUR = 0.00511;
        const HOURS_PER_MONTH = 730;

        // Calculate monthly op-geth cost based on current vCPU
        const memoryGiB = currentVcpu * 2;
        const opGethMonthlyCost = (currentVcpu * FARGATE_VCPU_HOUR + memoryGiB * FARGATE_MEM_GB_HOUR) * HOURS_PER_MONTH;

        // Cost for fixed 4 vCPU (Baseline)
        const fixedCost = (4 * FARGATE_VCPU_HOUR + 8 * FARGATE_MEM_GB_HOUR) * HOURS_PER_MONTH; // $165.67

        // Current savings vs 4 vCPU
        const currentSaving = fixedCost - opGethMonthlyCost;

        // Dynamic Scaler estimated average cost (70% 1vCPU, 20% 2vCPU, 10% 4vCPU)
        const avgVcpu = 0.7 * 1 + 0.2 * 2 + 0.1 * 4; // 1.5 vCPU Average
        const avgMemory = avgVcpu * 2;
        const dynamicMonthlyCost = (avgVcpu * FARGATE_VCPU_HOUR + avgMemory * FARGATE_MEM_GB_HOUR) * HOURS_PER_MONTH;
        const maxMonthlySaving = fixedCost - dynamicMonthlyCost; // ~$114

        const currentHourlyCost = opGethMonthlyCost / HOURS_PER_MONTH;

        // Record usage data (only for real data, not stress test)
        if (!isStressTest) {
          recordUsage(currentVcpu, effectiveCpu);
        }

        // Calculate block interval and push to metrics store
        const now = Date.now();
        const lastBlock = await getStore().getLastBlock();
        blockInterval = resolveBlockInterval({
          currentBlockHeight: blockNumber,
          lastBlockHeight: lastBlock.height,
          lastBlockTime: lastBlock.time,
          nowMs: now,
          seedBlockInterval: usingSeedMetrics ? blockInterval : undefined,
        });

        // Update tracking in store
        await getStore().setLastBlock(String(blockNumber), String(now));

        // Push data point to metrics store (only for real data, not stress test)
        let dataPoint: MetricDataPoint | null = null;
        if (!isStressTest) {
          dataPoint = {
            timestamp: new Date().toISOString(),
            cpuUsage: effectiveCpu,
            txPoolPending: effectiveTx,
            gasUsedRatio,
            blockHeight: Number(blockNumber),
            blockInterval,
            currentVcpu,
          };
          await pushMetric(dataPoint);
        }

        // ================================================================
        // Anomaly Detection Pipeline (Layer 1 → Layer 2 → Layer 3 → Layer 4)
        // Delegated to detection-pipeline.ts for reuse by agent-loop
        // ================================================================
        let detectedAnomalies: AnomalyResult[] = [];
        let activeAnomalyEventId: string | undefined;

        if (ANOMALY_DETECTION_ENABLED && !isStressTest && dataPoint) {
          try {
            const detection = await runDetectionPipeline(dataPoint);
            detectedAnomalies = detection.anomalies;
            activeAnomalyEventId = detection.activeEventId;
          } catch (anomalyError) {
            console.error('[Anomaly] Detection pipeline error:', anomalyError);
          }
        }

        // Compute sync lag: seconds since latest L2 block beyond expected interval
        const expectedInterval = getChainPlugin().expectedBlockIntervalSeconds;
        const blockAge = Math.floor(Date.now() / 1000) - Number(block.timestamp);
        const syncLag = Math.max(0, blockAge - expectedInterval);

        const responseSource = usingSeedMetrics ? 'SEED_SCENARIO' : 'REAL_K8S_CONFIG';
        const response = NextResponse.json({
            timestamp: new Date().toISOString(),
            metrics: {
                l1BlockHeight: Number(l1BlockNumber),
                blockHeight: Number(blockNumber),
                txPoolCount: effectiveTx,
                cpuUsage: Number(effectiveCpu.toFixed(2)),
                // Real memory from container metrics; fallback: vCPU * 2 GiB (Fargate memory formula)
                memoryUsage: containerUsage ? Math.round(containerUsage.memoryMiB) : currentVcpu * 2 * 1024,
                gethVcpu: currentVcpu,
                gethMemGiB: currentVcpu * 2,
                syncLag,
                cpuSource,
                source: responseSource,
            },
            components,
            cost: {
                hourlyRate: Number(currentHourlyCost.toFixed(3)),
                opGethMonthlyCost: Number(opGethMonthlyCost.toFixed(2)),
                currentSaving: Number(currentSaving.toFixed(2)),
                dynamicMonthlyCost: Number(dynamicMonthlyCost.toFixed(2)),
                maxMonthlySaving: Number(maxMonthlySaving.toFixed(2)),
                fixedCost: Number(fixedCost.toFixed(2)),
                isPeakMode: isStressTest,
                monthlyEstimated: Number(opGethMonthlyCost.toFixed(2)),
                monthlySaving: Number(currentSaving.toFixed(2)),
            },
            status: "healthy",
            stressMode: isStressTest,
            derivationLag: {
                ...derivationLagStatus,
                l1Healthy: l1HealthStatus.healthy,
                l1ResponseTimeMs: l1HealthStatus.responseTimeMs,
            },
            // === L2 Nodes L1 RPC Status ===
            l2NodesL1Rpc: isStressTest
                ? getChainPlugin().k8sComponents
                    .filter(c => c.l1RpcEnvVar)
                    .map(c => ({ component: c.component, l1RpcUrl: 'https://l1-rpc.mock***', healthy: true }))
                : await getL2NodesL1RpcStatus(),
            // === EOA Balance Status ===
            eoaBalances: await (async () => {
                try {
                    const status = await getAllBalanceStatus();
                    return {
                        batcher: status.batcher ? { address: status.batcher.address, balanceEth: status.batcher.balanceEth, level: status.batcher.level } : null,
                        proposer: status.proposer ? { address: status.proposer.address, balanceEth: status.proposer.balanceEth, level: status.proposer.level } : null,
                        challenger: status.challenger ? { address: status.challenger.address, balanceEth: status.challenger.balanceEth, level: status.challenger.level } : null,
                        signerAvailable: status.signerAvailable,
                    };
                } catch {
                    return { batcher: null, proposer: null, challenger: null, signerAvailable: false };
                }
            })(),
            disputeGames: await getDisputeGameStatus(l1RpcUrl),
            // === Anomaly Detection Fields ===
            anomalies: detectedAnomalies,
            activeAnomalyEventId,
        });

        // Disable caching
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        console.info(`[Timer] Total GET: ${(performance.now() - startTotal).toFixed(2)}ms`);
        return response;

    } catch (error) {
        console.error("Metric Fetch Error:", error);
        return NextResponse.json(
            { error: "Failed to fetch L2 metrics" },
            { status: 500 }
        );
    }
}
