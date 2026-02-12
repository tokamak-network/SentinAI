import { createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { NextResponse } from 'next/server';
import { recordUsage } from '@/lib/usage-tracker';

// Disable Next.js caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { pushMetric } from '@/lib/metrics-store';
import { MetricDataPoint } from '@/types/prediction';
import { runK8sCommand, getNamespace, getAppPrefix } from '@/lib/k8s-config';
import { getStore } from '@/lib/redis-store';
import { runDetectionPipeline } from '@/lib/detection-pipeline';
import { getContainerCpuUsage } from '@/lib/k8s-scaler';
import { getActiveL1RpcUrl, getL1FailoverState, maskUrl } from '@/lib/l1-rpc-failover';
import { getAllBalanceStatus } from '@/lib/eoa-balance-monitor';
import type { AnomalyResult } from '@/types/anomaly';

// Whether anomaly detection is enabled (default: enabled)
const ANOMALY_DETECTION_ENABLED = process.env.ANOMALY_DETECTION_ENABLED !== 'false';

// Block interval tracking moved to state store (Redis or InMemory)

interface ComponentDetail {
    name: string;
    type: string;
    strategy: string;
    current: string;
    status: string;
    icon: string;
    rawCpu: number;
    metrics?: {
        cpuReq: string;
        memReq: string;
        node: string;
    };
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
            metrics: {
                cpuReq: cpuDisp,
                memReq: memDisp,
                node: nodeName
            }
        };

    } catch (e) {
        console.error(`Failed to fetch ${displayName}:`, e);
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
                const l2Client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
                const l1Client = createPublicClient({ chain: sepolia, transport: http(l1RpcUrl) });
                const [l2Block, l1Block] = await Promise.all([
                    l2Client.getBlockNumber(),
                    l1Client.getBlockNumber(),
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
            status: "healthy"
        }, {
            headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
        });
    }
    // Debug: Log incoming request URL
    console.log('[API] Request URL:', request.url);
    const startTotal = performance.now();

    try {
        // 1. Parallel Data Fetch for All Components
        const appPrefix = getAppPrefix();

        const startK8s = performance.now();
        const [l2Client, consensus, batcher, proposer, containerUsage] = await Promise.all([
            getComponentDetails(`app=${appPrefix}-geth`, "L2 Client", "cpu", ""),
            getComponentDetails(`app=${appPrefix}-node`, "Consensus Node", "globe", ""),
            getComponentDetails(`app=${appPrefix}-batcher`, "Batcher", "shuffle", ""),
            getComponentDetails(`app=${appPrefix}-proposer`, "Proposer", "shield", ""),
            getContainerCpuUsage(),
        ]);
        console.log(`[Timer] K8s Fetch: ${(performance.now() - startK8s).toFixed(2)}ms`);

        const components = [l2Client, consensus, batcher, proposer];

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

        const l2RpcClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
        const l1RpcClient = createPublicClient({ chain: sepolia, transport: http(l1RpcUrl) });

        // Fetch L2 block details and L1 block number in parallel (1 less RPC call)
        const [block, l1BlockNumber] = await Promise.all([
            l2RpcClient.getBlock({ blockTag: 'latest' }),
            l1RpcClient.getBlockNumber()
        ]);
        const blockNumber = block.number;

        // Get actual TxPool pending count via txpool_status RPC
        let txPoolPending = 0;
        try {
            const txPoolResponse = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'txpool_status',
                    params: [],
                    id: 1,
                }),
            });
            const txPoolData = await txPoolResponse.json();
            if (txPoolData.result?.pending) {
                txPoolPending = parseInt(txPoolData.result.pending, 16);
            }
        } catch {
            // Fallback: use current block tx count if txpool_status not supported
            txPoolPending = block.transactions.length;
        }
        console.log(`[Timer] RPC Fetch: ${(performance.now() - startRpc).toFixed(2)}ms`);

        // 3. Metrics (Host Resource - Best Effort)
        const gasUsed = Number(block.gasUsed);
        const gasLimit = Number(block.gasLimit);
        const evmLoad = (gasUsed / gasLimit) * 100;

        // Use real container CPU if available, otherwise fallback to EVM load
        let cpuSource: 'container' | 'evm_load' = 'evm_load';
        let realCpu = evmLoad;
        if (containerUsage) {
            const requestMillicores = (l2Client?.rawCpu || 1) * 1000;
            realCpu = (containerUsage.cpuMillicores / requestMillicores) * 100;
            cpuSource = 'container';
        }

        // 4. Simulation & Stress Mode
        const url = new URL(request.url);
        const isStressTest = url.searchParams.get('stress') === 'true';

        let effectiveCpu = realCpu;
        const effectiveTx = txPoolPending;
        let currentVcpu: number = l2Client ? (l2Client.rawCpu || 1) : 1;

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
        let blockInterval = 2.0; // Default block interval (L2 typical)

        const lastBlock = await getStore().getLastBlock();
        if (lastBlock.height !== null && lastBlock.time !== null) {
          const lastHeight = BigInt(lastBlock.height);
          const lastTime = Number(lastBlock.time);
          if (blockNumber > lastHeight) {
            // New block detected, calculate interval
            const timeDiff = (now - lastTime) / 1000; // Convert to seconds
            const blockDiff = Number(blockNumber - lastHeight);
            blockInterval = timeDiff / blockDiff;
          }
        }

        // Update tracking in store
        await getStore().setLastBlock(String(blockNumber), String(now));

        // Push data point to metrics store (only for real data, not stress test)
        let dataPoint: MetricDataPoint | null = null;
        if (!isStressTest) {
          dataPoint = {
            timestamp: new Date().toISOString(),
            cpuUsage: effectiveCpu,
            txPoolPending: effectiveTx,
            gasUsedRatio: gasUsed / gasLimit,
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

        const response = NextResponse.json({
            timestamp: new Date().toISOString(),
            metrics: {
                l1BlockHeight: Number(l1BlockNumber),
                blockHeight: Number(blockNumber),
                txPoolCount: effectiveTx,
                cpuUsage: Number(effectiveCpu.toFixed(2)),
                memoryUsage: containerUsage ? Math.round(containerUsage.memoryMiB) : currentVcpu * 2 * 1024,
                gethVcpu: currentVcpu,
                gethMemGiB: currentVcpu * 2,
                syncLag: 0,
                cpuSource,
                source: "REAL_K8S_CONFIG"
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
            // === L1 RPC Status ===
            l1Rpc: (() => {
                const state = getL1FailoverState();
                const active = state.endpoints[state.activeIndex];
                return {
                    activeUrl: maskUrl(state.activeUrl),
                    healthy: active?.healthy ?? true,
                    endpointCount: state.endpoints.length,
                    healthyCount: state.endpoints.filter(e => e.healthy).length,
                    lastFailoverTime: state.lastFailoverTime
                        ? new Date(state.lastFailoverTime).toISOString()
                        : null,
                    consecutiveFailures: active?.consecutiveFailures ?? 0,
                };
            })(),
            // === EOA Balance Status ===
            eoaBalances: await (async () => {
                try {
                    const status = await getAllBalanceStatus();
                    return {
                        batcher: status.batcher ? { address: status.batcher.address, balanceEth: status.batcher.balanceEth, level: status.batcher.level } : null,
                        proposer: status.proposer ? { address: status.proposer.address, balanceEth: status.proposer.balanceEth, level: status.proposer.level } : null,
                        signerAvailable: status.signerAvailable,
                    };
                } catch {
                    return { batcher: null, proposer: null, signerAvailable: false };
                }
            })(),
            // === Anomaly Detection Fields ===
            anomalies: detectedAnomalies,
            activeAnomalyEventId,
        });

        // Disable caching
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        console.log(`[Timer] Total GET: ${(performance.now() - startTotal).toFixed(2)}ms`);
        return response;

    } catch (error) {
        console.error("Metric Fetch Error:", error);
        return NextResponse.json(
            { error: "Failed to fetch L2 metrics" },
            { status: 500 }
        );
    }
}
