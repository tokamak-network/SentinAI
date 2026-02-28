import type { ChainAIPrompts } from '../types';

const RCA_SYSTEM_PROMPT = `You are performing Root Cause Analysis (RCA) for a generic ZK L2 chain incident.

Core components:
1. zk-sequencer (execution + RPC)
2. zk-batcher (batch posting to settlement layer)
3. zk-prover (proof generation)
4. l1 (settlement dependency)

Prioritize sequencer availability, settlement lag, and proof backlog when building the causal chain.`;

const ANOMALY_ANALYZER_CONTEXT = `## Generic ZK L2 component relationships:
- zk-sequencer is the primary execution path
- zk-batcher publishes L2 batches to settlement
- zk-prover generates validity proofs
- l1/network instability propagates to settlement lag`;

const FAILURE_PATTERNS = `1. Sequencer/RPC stall -> block growth plateau
2. Batcher submit failures -> settlement/finality lag
3. Prover backlog -> proof queue depth increase
4. Parent-chain RPC instability -> cascading settlement issues`;

const PREDICTIVE_SCALER_CONTEXT = `CONTEXT:
- Target: zk-sequencer primary execution process
- Scale conservatively to keep ordering stability
- Treat settlement/proof lag as leading signals`;

const COST_OPTIMIZER_CONTEXT = `## Infrastructure Context
- Focus on sequencer and prover resource balance
- Avoid overprovisioning prover when proof queue remains stable
- Keep settlement latency under operational SLOs`;

const DAILY_REPORT_CONTEXT = `You are a generic ZK L2 operations expert. Summarize execution, settlement, and proof pipeline health for the last 24 hours.`;

const NLOPS_SYSTEM_CONTEXT = `You are a helpful assistant for SentinAI, specialized in generic ZK L2 operations.`;

export const ZKL2_GENERIC_AI_PROMPTS: ChainAIPrompts = {
  rcaSystemPrompt: RCA_SYSTEM_PROMPT,
  anomalyAnalyzerContext: ANOMALY_ANALYZER_CONTEXT,
  predictiveScalerContext: PREDICTIVE_SCALER_CONTEXT,
  costOptimizerContext: COST_OPTIMIZER_CONTEXT,
  dailyReportContext: DAILY_REPORT_CONTEXT,
  nlopsSystemContext: NLOPS_SYSTEM_CONTEXT,
  failurePatterns: FAILURE_PATTERNS,
};
