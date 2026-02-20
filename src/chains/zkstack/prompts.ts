import type { ChainAIPrompts } from '../types';

const RCA_SYSTEM_PROMPT = `You are performing Root Cause Analysis (RCA) for a ZK Stack chain incident.

Core components:
1. zksync-server (sequencer + RPC)
2. zk-batcher (L1 or Gateway settlement posting)
3. zk-prover (proof generation pipeline)
4. l1 (settlement dependency)

Prioritize proof lag, settlement lag, and sequencer availability when building the causal chain.`;

const ANOMALY_ANALYZER_CONTEXT = `## ZK Stack component relationships:
- zksync-server is the primary execution and RPC gateway
- zk-batcher publishes batches to settlement
- zk-prover generates proofs asynchronously
- l1 or gateway health affects finality`;

const FAILURE_PATTERNS = `1. Sequencer RPC stall -> block growth plateau
2. Settlement posting delay -> finality lag
3. Prover backlog -> proof queue depth increase
4. L1 RPC instability -> batch posting failures`;

const PREDICTIVE_SCALER_CONTEXT = `CONTEXT:
- Target: zksync-server primary execution process
- Scale conservatively to protect sequencer stability
- Consider proof/settlement lag as leading indicators`;

const COST_OPTIMIZER_CONTEXT = `## Infrastructure Context
- Focus on sequencer and prover resource balance
- Avoid over-provisioning prover when queue depth is stable
- Keep settlement latency within SLO`;

const DAILY_REPORT_CONTEXT = `You are a ZK Stack operations expert. Summarize execution, settlement, and proof pipeline health for the last 24 hours.`;

const NLOPS_SYSTEM_CONTEXT = `You are a helpful assistant for SentinAI, specialized in ZK Stack chain operations.`;

export const ZKSTACK_AI_PROMPTS: ChainAIPrompts = {
  rcaSystemPrompt: RCA_SYSTEM_PROMPT,
  anomalyAnalyzerContext: ANOMALY_ANALYZER_CONTEXT,
  predictiveScalerContext: PREDICTIVE_SCALER_CONTEXT,
  costOptimizerContext: COST_OPTIMIZER_CONTEXT,
  dailyReportContext: DAILY_REPORT_CONTEXT,
  nlopsSystemContext: NLOPS_SYSTEM_CONTEXT,
  failurePatterns: FAILURE_PATTERNS,
};
