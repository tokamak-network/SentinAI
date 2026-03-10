/**
 * L1 EVM Node Plugin — AI Prompt Fragments
 */

import type { ChainAIPrompts } from '../types';

export const L1_EVM_AI_PROMPTS: ChainAIPrompts = {
  rcaSystemPrompt: `You are analyzing a standalone L1 EVM execution client (Geth, Reth, Nethermind, or Besu).
The only monitored component is 'l1-execution'. There are no L2 downstream consumers.
Common failure modes:
- Block production stall: node stuck on a fork, bad peer, or DB corruption
- Peer isolation: firewall change, P2P port closed, bootnode unreachable
- Sync lag: node fell behind the chain tip (resuming from a stall)
- Resource exhaustion: heavy transaction workloads cause OOM or CPU saturation
- Disk pressure: chain state growth (archive nodes) or pruning lag`,

  anomalyAnalyzerContext: `Monitoring a standalone L1 EVM node.
Component: l1-execution (Geth/Reth/Nethermind/Besu).
Key metrics: blockInterval (normal ~12s for Ethereum), peerCount (healthy > 10),
syncGap (0 when synced), txPoolPending (baseline 100-5000), cpuUsage, memoryPercent.
Block stalls and peer drops are high-priority anomalies.`,

  predictiveScalerContext: `Scaling target: l1-execution (L1 EVM node pod).
L1 nodes are memory-heavy (state trie) and I/O-bound (chain reads).
High mempool activity correlates with CPU pressure.
Scale up when cpuUsage > 80 or memoryPercent > 80 for 3+ consecutive cycles.`,

  costOptimizerContext: `L1 EVM node running in isolation.
Node resources scale with chain state size and transaction volume.
Archive nodes require significantly more disk and memory than full/snap nodes.`,

  dailyReportContext: `Standalone L1 EVM node guardian report.
Tracks: block production health, peer connectivity, sync status, mempool depth,
resource utilization, and auto-remediation actions taken.`,

  nlopsSystemContext: `You are monitoring a standalone L1 EVM execution client.
The system has one component: the L1 node (l1-execution).
Available actions: scale resources, restart pod, switch RPC endpoint, escalate to operator.
Block stalls, peer isolation, and OOM are the most common incidents.`,

  failurePatterns: `L1 node failure patterns:
1. Block stall: blockInterval spikes to 60s+ — peer issue or DB problem
2. Peer isolation: peerCount drops to 0 — P2P config or firewall issue
3. OOM crash: memoryPercent > 95 — state trie growth or memory leak
4. Sync lag: syncGap increases — node fell behind after recovery
5. Mempool spike: txPoolPending > 10000 — unusual network activity
6. Disk pressure: node logs disk full — archive pruning required`,
};
