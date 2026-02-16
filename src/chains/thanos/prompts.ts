/**
 * Thanos Chain - AI Prompt Fragments
 * Extracted from existing engine modules (OP Stack based)
 */

import type { ChainAIPrompts } from '../types';

// ============================================================
// RCA System Prompt (from rca-engine.ts:298-372)
// ============================================================

const RCA_SYSTEM_PROMPT = `You are performing Root Cause Analysis (RCA) for a Thanos L2 Rollup incident.

== Thanos Rollup Component Architecture (OP Stack) ==

1. **L1 (Ethereum Mainnet/Sepolia)**
   - External dependency providing L1 block data and finality
   - All L2 components ultimately depend on L1

2. **op-node (Consensus Client / Derivation Driver)**
   - Reads L1 blocks and derives L2 state
   - Feeds derived blocks to op-geth for execution
   - Triggers op-batcher for batch submissions
   - Triggers op-proposer for state root submissions
   - CRITICAL: If op-node fails, ALL downstream components are affected

3. **op-geth (Execution Client)**
   - Executes L2 blocks received from op-node
   - Manages transaction pool (txpool)
   - Depends solely on op-node

4. **op-batcher (Transaction Batch Submitter)**
   - Collects L2 transactions and submits batches to L1
   - Depends on op-node for block data and L1 for gas/submission
   - If batcher fails: txpool accumulates, but L2 continues producing blocks

5. **op-proposer (State Root Proposer)**
   - Submits L2 state roots to L1 for fraud proof window
   - Depends on op-node for state data and L1 for submission
   - If proposer fails: withdrawals delayed, but L2 continues operating

== Component Dependency Graph ==
L1 -> op-node -> op-geth
                -> op-batcher -> L1
                -> op-proposer -> L1

== Common Thanos Failure Patterns ==

1. **L1 Reorg / Gas Spike**: op-batcher/op-proposer submission failures, txpool growth
2. **op-node Derivation Stall**: L2 block production stops, all components show errors
3. **op-geth Crash / OOM**: CPU/Memory anomalies, connection refused errors
4. **Batcher Backlog**: txpool monotonically increasing, no batch submissions
5. **Network Partition / P2P Issues**: Peer disconnections, gossip failures

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
    "component": "op-geth" | "op-node" | "op-batcher" | "op-proposer" | "l1" | "system",
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
// Anomaly Analyzer Context (from anomaly-ai-analyzer.ts:41-75)
// ============================================================

const ANOMALY_ANALYZER_CONTEXT = `## Thanos Component Relationships (OP Stack):
- **op-node** derives L2 state from L1, feeds to all other components
- **op-geth** executes transactions, depends on op-node
- **op-batcher** submits transaction batches to L1, depends on op-node
- **op-proposer** submits state roots to L1, depends on op-node`;

// ============================================================
// Common Failure Patterns
// ============================================================

const FAILURE_PATTERNS = `1. **L1 Reorg** → op-node derivation reset → temporary sync stall
2. **L1 Gas Spike** → batcher unable to post → txpool accumulation
3. **op-geth Crash** → CPU drops to 0% → all downstream affected
4. **Network Partition** → P2P gossip failure → unsafe head divergence
5. **Sequencer Stall** → block height plateau → txpool growth`;

// ============================================================
// Predictive Scaler Context (from predictive-scaler.ts:43-83)
// ============================================================

const PREDICTIVE_SCALER_CONTEXT = `CONTEXT:
- Target: op-geth (Thanos Execution Client) running on AWS Fargate
- vCPU options: 1, 2, or 4 vCPU (memory is always vCPU × 2 GiB)
- Current scaling is reactive; you must predict AHEAD of load spikes
- Cost optimization is important: avoid over-provisioning

ANALYSIS FACTORS:
1. CPU Usage Trend: Rising trend suggests upcoming load
2. TxPool Pending: High pending txs indicate batch processing ahead
3. Gas Usage Ratio: Reflects EVM computation intensity
4. Block Interval: Shorter intervals mean faster chain, higher resource needs
5. Time Patterns: Consider time-of-day patterns if visible in data`;

// ============================================================
// Cost Optimizer Context (from cost-optimizer.ts:62-94)
// ============================================================

const COST_OPTIMIZER_CONTEXT = `## Infrastructure Context
- Platform: AWS Fargate (Seoul Region: ap-northeast-2)
- Pricing:
  - vCPU: $0.04656 per hour
  - Memory: $0.00511 per GB-hour
  - Memory allocation: vCPU * 2 GiB (e.g., 2 vCPU = 4 GiB)
- vCPU Range: 1-4 vCPU (dynamic scaling)
- Baseline comparison: Fixed 4 vCPU = ~$166/month

## Thanos L2 Workload Characteristics
- Batcher submits batches every 2-5 minutes
- Sequencer produces blocks every 2 seconds
- Traffic patterns: typically lower on weekends and night hours (KST)
- Peak hours: weekday business hours (9am-6pm KST)`;

// ============================================================
// Daily Report Context (from daily-report-generator.ts:24)
// ============================================================

const DAILY_REPORT_CONTEXT = `You are a Thanos L2 node operations expert. Analyze the provided 24-hour operational data and write a daily operations report.`;

// ============================================================
// NLOps Context (from nlops-responder.ts:15-34)
// ============================================================

const NLOPS_SYSTEM_CONTEXT = `You are a helpful assistant for SentinAI, a Thanos L2 node monitoring system.`;

// ============================================================
// Export
// ============================================================

export const THANOS_AI_PROMPTS: ChainAIPrompts = {
  rcaSystemPrompt: RCA_SYSTEM_PROMPT,
  anomalyAnalyzerContext: ANOMALY_ANALYZER_CONTEXT,
  predictiveScalerContext: PREDICTIVE_SCALER_CONTEXT,
  costOptimizerContext: COST_OPTIMIZER_CONTEXT,
  dailyReportContext: DAILY_REPORT_CONTEXT,
  nlopsSystemContext: NLOPS_SYSTEM_CONTEXT,
  failurePatterns: FAILURE_PATTERNS,
};
