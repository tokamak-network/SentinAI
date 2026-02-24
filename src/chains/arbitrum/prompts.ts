/**
 * Arbitrum Orbit Chain - AI Prompt Fragments
 * Nitro architecture: integrated sequencer + execution, Brotli batching, Interactive Fraud Proof
 */

import type { ChainAIPrompts } from '../types';

// ============================================================
// RCA System Prompt
// ============================================================

const RCA_SYSTEM_PROMPT = `You are performing Root Cause Analysis (RCA) for an Arbitrum Orbit L2 Rollup incident.

== Arbitrum Orbit Component Architecture ==

1. **L1 (Ethereum Mainnet/Sepolia)**
   - External dependency providing sequencer inbox, delayed inbox, and finality
   - All L2 components ultimately depend on L1

2. **nitro-node (Integrated Execution + Sequencer)**
   - Single binary combining execution engine and sequencer (unlike OP Stack which splits them)
   - Reads L1 delayed inbox messages, produces L2 blocks (~0.25s interval)
   - Feeds block data to batch-poster and validator
   - CRITICAL: If nitro-node fails, ALL downstream components are affected
   - AnyTrust mode: also connects to DAS (Data Availability Server)

3. **batch-poster (Batch Submitter)**
   - Reads from nitro-node's sequencer feed
   - Compresses batches using Brotli (or EIP-4844 blobs) and submits to L1 SequencerInbox
   - If batch-poster fails: delayed finality on L1, but L2 continues producing blocks
   - Requires sufficient ETH for L1 gas + blob fees

4. **validator (RBlock Proposer / Fraud Proof Participant)**
   - Posts RBlocks (Rollup Blocks) containing L2 block hashes to L1 RollupCore
   - Participates in Interactive Fraud Proof (iBisection) if challenged
   - If validator fails: L2 withdrawals delayed, but sequencing continues
   - Requires sufficient ETH for L1 assertions and fraud proof bonds

== Component Dependency Graph ==
L1 -> nitro-node -> batch-poster -> L1
               -> validator -> L1

== Arbitrum-Specific Failure Patterns ==

1. **L1 Gas Spike / EIP-4844 Blob Fee Surge**: batch-poster submission failures, batch backlog
2. **nitro-node Inbox Derivation Stall**: L2 block production stops if delayed inbox falls behind
3. **nitro-node OOM / CPU Spike**: High volume of 0.25s blocks causes resource exhaustion faster than OP Stack
4. **Batch Poster Backlog**: SequencerInbox data accumulating faster than posting, txpool growth
5. **Validator Assertion Failure**: RBlock submission rejected due to fork or incorrect state
6. **Interactive Fraud Proof Challenge**: Validator must respond within challenge deadline
7. **Batch Poster EOA Low Balance**: Cannot pay L1 gas + blob fees — batches stop
8. **Validator EOA Low Balance**: Cannot post RBlocks or participate in fraud proof — security risk
9. **AnyTrust DAS Unavailable**: DA server unreachable, batch poster falls back to rollup mode

== Your Task ==

Given the event timeline, anomalies, metrics, and logs below:

1. **Identify the ROOT CAUSE**: Find the earliest triggering event
2. **Trace the CAUSAL CHAIN**: Follow propagation from root cause to symptoms
3. **Consider Dependencies**: Upstream failures propagate downstream
4. **Provide REMEDIATION**: Immediate steps + preventive measures

== Output Format ==

Respond ONLY with a valid JSON object (no markdown code blocks):
{
  "rootCause": {
    "component": "nitro-node" | "batch-poster" | "validator" | "l1" | "system",
    "description": "Clear explanation of what triggered the incident",
    "confidence": 0.0-1.0
  },
  "causalChain": [
    {
      "timestamp": <unix_ms>,
      "component": "<component>",
      "type": "error" | "warning" | "metric_anomaly" | "state_change",
      "description": "What happened at this step"
    }
  ],
  "affectedComponents": ["<component1>", "<component2>"],
  "remediation": {
    "immediate": ["Step 1", "Step 2"],
    "preventive": ["Measure 1", "Measure 2"]
  }
}`;

// ============================================================
// Anomaly Analyzer Context
// ============================================================

const ANOMALY_ANALYZER_CONTEXT = `## Arbitrum Orbit Component Relationships:
- **nitro-node** is the integrated sequencer + execution engine; produces L2 blocks every ~0.25s
- **batch-poster** reads from nitro-node and submits Brotli-compressed batches (or EIP-4844 blobs) to L1 SequencerInbox
- **validator** posts RBlocks to L1 RollupCore and participates in Interactive Fraud Proof challenges`;

// ============================================================
// Common Failure Patterns
// ============================================================

const FAILURE_PATTERNS = `1. **L1 Inbox Derivation Stall** → nitro-node delayed inbox lag → L2 blocks stop
2. **EIP-4844 Blob Fee Spike** → batch-poster submission failure → batch backlog grows
3. **nitro-node OOM** → 0.25s block rate exhausts memory → all downstream affected
4. **Batch Poster Backlog** → SequencerInbox lag → finality delay on L1
5. **Validator Assertion Failure** → incorrect RBlock rejected → withdrawal delay`;

// ============================================================
// Predictive Scaler Context
// ============================================================

const PREDICTIVE_SCALER_CONTEXT = `CONTEXT:
- Target: nitro-node (Arbitrum Orbit Execution Client) running on AWS Fargate
- vCPU options: 1, 2, or 4 vCPU (memory is always vCPU × 2 GiB)
- Block interval is ~0.25s (4x faster than OP Stack) — resource exhaustion happens faster
- Current scaling is reactive; you must predict AHEAD of load spikes
- Cost optimization is important: avoid over-provisioning

ANALYSIS FACTORS:
1. CPU Usage Trend: Rising trend suggests upcoming load (0.25s blocks amplify this)
2. TxPool Pending: High pending txs indicate batch processing ahead
3. Gas Usage Ratio: Reflects EVM computation intensity
4. Block Interval: Arbitrum targets 0.25s; deviation indicates stress
5. Batch Poster Lag: Unposted batches accumulate if nitro-node is under pressure`;

// ============================================================
// Cost Optimizer Context
// ============================================================

const COST_OPTIMIZER_CONTEXT = `## Infrastructure Context
- Platform: AWS Fargate (Seoul Region: ap-northeast-2)
- Pricing:
  - vCPU: $0.04656 per hour
  - Memory: $0.00511 per GB-hour
  - Memory allocation: vCPU * 2 GiB (e.g., 2 vCPU = 4 GiB)
- vCPU Range: 1-4 vCPU (dynamic scaling)
- Baseline comparison: Fixed 4 vCPU = ~$166/month

## Arbitrum Orbit Workload Characteristics
- nitro-node produces blocks every ~0.25s (4x OP Stack throughput)
- batch-poster posts Brotli-compressed batches (with optional EIP-4844 blobs)
- validator posts RBlocks every few minutes when new assertion checkpoints occur
- Traffic patterns: typically lower on weekends and night hours (KST)
- Peak hours: weekday business hours (9am-6pm KST)`;

// ============================================================
// Daily Report Context
// ============================================================

const DAILY_REPORT_CONTEXT = `You are an Arbitrum Orbit L2 node operations expert. Analyze the provided 24-hour operational data and write a daily operations report.`;

// ============================================================
// NLOps Context
// ============================================================

const NLOPS_SYSTEM_CONTEXT = `You are a helpful assistant for SentinAI, an Arbitrum Orbit L2 node monitoring system.`;

// ============================================================
// Export
// ============================================================

export const ARBITRUM_AI_PROMPTS: ChainAIPrompts = {
  rcaSystemPrompt: RCA_SYSTEM_PROMPT,
  anomalyAnalyzerContext: ANOMALY_ANALYZER_CONTEXT,
  predictiveScalerContext: PREDICTIVE_SCALER_CONTEXT,
  costOptimizerContext: COST_OPTIMIZER_CONTEXT,
  dailyReportContext: DAILY_REPORT_CONTEXT,
  nlopsSystemContext: NLOPS_SYSTEM_CONTEXT,
  failurePatterns: FAILURE_PATTERNS,
};
