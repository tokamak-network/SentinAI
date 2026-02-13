/**
 * Production Prompts for Benchmarking
 * 5 real-world prompts extracted from SentinAI modules
 */

import type { PromptDefinition } from './types';

/**
 * Parse JSON safely from text (handles markdown code blocks)
 */
function tryParseJSON(text: string): unknown {
  try {
    // Remove markdown code fences
    const cleaned = text
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    // Find first '{' and match closing '}'
    const start = cleaned.indexOf('{');
    if (start === -1) return null;

    let braceCount = 0;
    for (let i = start; i < cleaned.length; i++) {
      if (cleaned[i] === '{') braceCount++;
      if (cleaned[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          return JSON.parse(cleaned.substring(start, i + 1));
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Predictive Scaler: Time-series prediction for vCPU scaling
 * Tier: fast | Output: JSON
 */
const PREDICTIVE_SCALER: PromptDefinition = {
  id: 'predictive-scaler',
  tier: 'fast',
  description: 'AI-powered time-series vCPU prediction',
  systemPrompt: `You are an expert Site Reliability Engineer specializing in Kubernetes auto-scaling for Optimism L2 blockchain nodes.

Your task is to analyze time-series metrics and predict the optimal vCPU allocation for the next 5 minutes.

CONTEXT:
- Target: op-geth (Optimism Execution Client) running on AWS Fargate
- vCPU options: 1, 2, or 4 vCPU (memory is always vCPU × 2 GiB)
- Current scaling is reactive; you must predict AHEAD of load spikes
- Cost optimization is important: avoid over-provisioning

ANALYSIS FACTORS:
1. CPU Usage Trend: Rising trend suggests upcoming load
2. TxPool Pending: High pending txs indicate batch processing ahead
3. Gas Usage Ratio: Reflects EVM computation intensity
4. Block Interval: Shorter intervals mean faster chain, higher resource needs
5. Time Patterns: Consider time-of-day patterns if visible in data

DECISION RULES:
- Stable low load (CPU < 30%, TxPool < 50): Recommend 1 vCPU
- Moderate or rising load: Recommend 2 vCPU
- High load or spike incoming: Recommend 4 vCPU
- When in doubt, prioritize availability over cost

OUTPUT FORMAT:
Return ONLY a valid JSON object (no markdown, no explanation outside JSON):
{
  "predictedVcpu": 1 | 2 | 4,
  "confidence": 0.0 to 1.0,
  "trend": "rising" | "falling" | "stable",
  "reasoning": "Concise summary under 200 characters. State the key metric trend and recommended action in one sentence.",
  "recommendedAction": "scale_up" | "scale_down" | "maintain",
  "factors": [
    { "name": "factorName", "impact": -1.0 to 1.0, "description": "short phrase" }
  ]
}

IMPORTANT CONSTRAINTS:
- "reasoning" MUST be under 200 characters. Be concise: summarize the core insight, not every detail.
- "description" in factors MUST be under 60 characters each.`,
  userPrompt: `Current vCPU: 2

## Recent Metrics (last 15 samples, 5 minutes ago → now)

| Time | CPU (%) | TxPool | Gas (%) | Block (ms) |
|------|---------|--------|---------|------------|
| 14:00 | 32.1 | 45 | 42.3 | 2100 |
| 14:20 | 35.8 | 52 | 48.1 | 2050 |
| 14:40 | 41.2 | 68 | 55.7 | 1950 |
| 15:00 | 45.6 | 87 | 62.4 | 1880 |
| 15:20 | 52.3 | 125 | 71.8 | 1750 |
| 15:40 | 58.1 | 178 | 78.2 | 1620 |
| 16:00 | 62.4 | 234 | 82.6 | 1500 |
| 16:20 | 65.3 | 287 | 85.1 | 1480 |
| 16:40 | 68.1 | 312 | 87.3 | 1420 |
| 17:00 | 69.2 | 334 | 88.5 | 1410 |
| 17:20 | 70.1 | 356 | 89.2 | 1390 |
| 17:40 | 71.3 | 378 | 89.8 | 1375 |
| 18:00 | 72.1 | 402 | 90.2 | 1360 |
| 18:20 | 72.8 | 421 | 90.5 | 1352 |
| 18:40 | 73.2 | 445 | 90.8 | 1345 |

## Statistics
- CPU Mean: 55.3%, StdDev: 14.2%, Trend: rising (slope: +2.4%/sample)
- TxPool Mean: 198, Trend: rising
- Gas Mean: 76.4%, Trend: rising
- Block Mean: 1625ms, Trend: falling

## Recommendation
Based on the rising CPU trend (currently 73.2%, +2.4%/sample) and high TxPool, predict vCPU allocation for the next 5 minutes.`,
  expectedOutputType: 'json',
  validationFn: (content: string) => {
    const parsed = tryParseJSON(content);
    if (!parsed || typeof parsed !== 'object') return false;
    const obj = parsed as Record<string, unknown>;
    return (
      [1, 2, 4].includes(obj.predictedVcpu as number) &&
      typeof obj.confidence === 'number' &&
      obj.confidence >= 0 &&
      obj.confidence <= 1 &&
      ['rising', 'falling', 'stable'].includes(obj.trend as string) &&
      typeof obj.reasoning === 'string' &&
      obj.reasoning.length <= 200 &&
      ['scale_up', 'scale_down', 'maintain'].includes(obj.recommendedAction as string) &&
      Array.isArray(obj.factors)
    );
  },
};

/**
 * Anomaly AI Analyzer: Semantic anomaly analysis
 * Tier: fast | Output: JSON
 */
const ANOMALY_ANALYZER: PromptDefinition = {
  id: 'anomaly-analyzer',
  tier: 'fast',
  description: 'AI-powered anomaly semantic analysis',
  systemPrompt: `You are a Senior SRE for an Optimism L2 Rollup Network performing anomaly analysis.

Your task is to analyze detected anomalies in the context of:
1. **Metrics data** - CPU, TxPool, Gas, Block intervals
2. **Component logs** - op-geth, op-node, op-batcher, op-proposer
3. **Known failure patterns** for Optimism Rollups

## Optimism Component Relationships:
- **op-node** derives L2 state from L1, feeds to all other components
- **op-geth** executes transactions, depends on op-node
- **op-batcher** submits transaction batches to L1, depends on op-node
- **op-proposer** submits state roots to L1, depends on op-node

## Common Failure Patterns:
1. **L1 Reorg** → op-node derivation reset → temporary sync stall
2. **L1 Gas Spike** → batcher unable to post → txpool accumulation
3. **op-geth Crash** → CPU drops to 0% → all downstream affected
4. **Network Partition** → P2P gossip failure → unsafe head divergence
5. **Sequencer Stall** → block height plateau → txpool growth

## Analysis Guidelines:
- Correlate anomalies: multiple symptoms often share a root cause
- Consider timing: which anomaly appeared first?
- Check logs for error messages, warnings, state changes
- Assess impact: how does this affect end users?

Return ONLY a JSON object (no markdown code blocks):
{
  "severity": "low" | "medium" | "high" | "critical",
  "anomalyType": "performance" | "security" | "consensus" | "liveness",
  "correlations": ["correlation1", "correlation2"],
  "predictedImpact": "description of expected impact",
  "suggestedActions": ["action1", "action2"],
  "relatedComponents": ["op-geth", "op-node"]
}`,
  userPrompt: `## Detected Anomalies

1. [txPool] TxPool pending increased 567% in 2 minutes (rule: spike, z-score: 3.8)
2. [blockInterval] Block interval increased 45% to 2050ms (rule: trend_increase, z-score: 2.6)
3. [cpuUsage] CPU usage dropped 62% in 30 seconds (rule: drop, z-score: 3.2)

## Current Metrics
- CPU: 8.3% (normal 55-75%)
- TxPool: 2,847 pending (normal 45-200)
- Gas Ratio: 12.1% (normal 75-90%)
- Block Interval: 2050ms (normal 1400-1600ms)

## Recent Component Logs

[op-geth logs]
2026-02-13 18:45:23.891 ERR p2p/server error processing peer: connection reset
2026-02-13 18:45:24.102 WRN core/state_processor: slow block: took 1850ms
2026-02-13 18:45:24.891 ERR core/blockchain: failed to insert block, out of memory

[op-node logs]
2026-02-13 18:45:25.001 WRN rollup/derive: L1 reorg detected, resetting derivation
2026-02-13 18:45:25.205 ERR rollup/sync: failed to sync from L1: context deadline exceeded

Analyze these anomalies and predict the impact.`,
  expectedOutputType: 'json',
  validationFn: (content: string) => {
    const parsed = tryParseJSON(content);
    if (!parsed || typeof parsed !== 'object') return false;
    const obj = parsed as Record<string, unknown>;
    return (
      ['low', 'medium', 'high', 'critical'].includes(obj.severity as string) &&
      ['performance', 'security', 'consensus', 'liveness'].includes(obj.anomalyType as string) &&
      Array.isArray(obj.correlations) &&
      typeof obj.predictedImpact === 'string' &&
      Array.isArray(obj.suggestedActions) &&
      Array.isArray(obj.relatedComponents)
    );
  },
};

/**
 * RCA Engine: Root cause analysis
 * Tier: best | Output: JSON
 */
const RCA_ENGINE: PromptDefinition = {
  id: 'rca-engine',
  tier: 'best',
  description: 'Root cause analysis with dependency tracing',
  systemPrompt: `You are performing Root Cause Analysis (RCA) for an Optimism L2 Rollup incident.

== Optimism Rollup Component Architecture ==

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

== Common Optimism Failure Patterns ==

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
}`,
  userPrompt: `== Event Timeline (chronological) ==
[
  {
    "time": "2026-02-13T18:45:20Z",
    "component": "l1",
    "type": "metric_anomaly",
    "description": "L1 gas price spike to 150 gwei (from 45 gwei average)"
  },
  {
    "time": "2026-02-13T18:45:22Z",
    "component": "op-batcher",
    "type": "warning",
    "description": "batch submission failed: transaction reverted (gas too low)"
  },
  {
    "time": "2026-02-13T18:45:25Z",
    "component": "op-geth",
    "type": "metric_anomaly",
    "description": "txpool pending increased from 45 to 1,200 in 3 seconds"
  },
  {
    "time": "2026-02-13T18:45:30Z",
    "component": "op-geth",
    "type": "error",
    "description": "CPU usage increased to 92% (was 55%)"
  }
]

== Detected Anomalies ==
- l1: Gas price spike (z-score: 4.2)
- op-geth: TxPool spike (z-score: 3.8)
- op-geth: CPU spike (z-score: 3.2)

== Recent Metrics ==
[
  {"time": "2026-02-13T18:45:15Z", "cpu": 55.2, "txPool": 45, "gasRatio": 82.1},
  {"time": "2026-02-13T18:45:20Z", "cpu": 58.1, "txPool": 120, "gasRatio": 79.5},
  {"time": "2026-02-13T18:45:25Z", "cpu": 92.3, "txPool": 1200, "gasRatio": 15.2}
]

== Component Logs ==
=== l1 (last 5 lines) ===
L1 Gas price: 150 gwei (spike from 45 gwei average)
Network congestion detected

=== op-batcher (last 5 lines) ===
batch submission failed: transaction reverted (gas too low)
retrying with higher gas...
submission failed again (out of funds)

=== op-geth (last 5 lines) ===
txpool: 1200 pending transactions
cpu: 92%
block production: degraded

Trace the root cause of this incident.`,
  expectedOutputType: 'json',
  validationFn: (content: string): boolean => {
    const parsed = tryParseJSON(content);
    if (!parsed || typeof parsed !== 'object') return false;
    const obj = parsed as Record<string, unknown>;
    const rc = obj.rootCause as Record<string, unknown> | undefined;
    const isValid =
      rc &&
      ['op-geth', 'op-node', 'op-batcher', 'op-proposer', 'l1', 'system'].includes(rc.component as string) &&
      typeof rc.confidence === 'number' &&
      rc.confidence >= 0 &&
      rc.confidence <= 1 &&
      Array.isArray(obj.causalChain) &&
      Array.isArray(obj.affectedComponents) &&
      obj.remediation &&
      typeof obj.remediation === 'object' &&
      Array.isArray((obj.remediation as Record<string, unknown>).immediate) &&
      Array.isArray((obj.remediation as Record<string, unknown>).preventive);
    return !!isValid;
  },
};

/**
 * Daily Report Generator: Long-form report generation
 * Tier: best | Output: Markdown
 */
const DAILY_REPORT: PromptDefinition = {
  id: 'daily-report',
  tier: 'best',
  description: 'AI-powered Korean daily operation report',
  systemPrompt: `당신은 Optimism L2 노드 운영 전문가입니다. 제공된 24시간 운영 데이터를 분석하여 한국어로 일일 운영 보고서를 작성합니다.

보고서 구조:

# SentinAI 일일 운영 보고서 — {날짜}

## 1. 요약 (Executive Summary)
하루 전체 운영 상태를 3-4문장으로 요약합니다.

## 2. 핵심 지표 분석
### 2.1 CPU 사용률
시간대별 패턴, 피크 시간, 평균 부하 분석.
### 2.2 트랜잭션 풀
TxPool pending 추이, 비정상적 급증 여부.
### 2.3 Gas 사용률
Gas 사용 비율 추이, EVM 연산 부하 분석.
### 2.4 블록 생성
블록 간격 추이, 총 블록 수, 체인 건강성 평가.

## 3. 리소스 스케일링 리뷰
스케일링 이벤트 적절성 평가, vCPU 변경 이력 분석.
스케일링 이벤트가 없었다면 현재 리소스가 적절한지 평가.

## 4. 이상 징후 및 보안
로그 분석에서 발견된 warning/critical 이슈 분석.
이슈가 없었다면 "이상 없음"으로 기록.

## 5. 권고사항
발견된 이슈에 대한 구체적 조치 제안.
트렌드 기반 내일 예측 및 사전 조치 권고.

작성 규칙:
- 한국어로 작성
- 마크다운 형식 (헤더, 테이블, 목록 활용)
- 데이터에 근거한 객관적 분석
- 데이터 부족 시 해당 섹션에서 명시적으로 언급
- 권고사항은 Optimism 공식 문서 기반`,
  userPrompt: `## 일일 운영 데이터 (2026-02-13)

### 주요 통계
- 평균 CPU: 52.3%
- 최대 CPU: 78.5%
- 평균 TxPool: 156
- 최대 TxPool: 1,245
- 평균 Gas Ratio: 74.2%
- 블록 생성 개수: 612개
- 평균 블록 간격: 1,423ms

### 시간별 요약
- 00:00-06:00: 저부하 (CPU 32-45%, TxPool 30-60)
- 06:00-12:00: 정상 (CPU 48-62%, TxPool 120-250)
- 12:00-18:00: 높은 부하 (CPU 65-78%, TxPool 400-1200)
- 18:00-24:00: 정상화 (CPU 50-60%, TxPool 180-300)

### 스케일링 이벤트
- 12:15 UTC: 2vCPU → 4vCPU (gas spike로 인한 TxPool 증가)
- 15:45 UTC: 4vCPU → 2vCPU (부하 감소)

### 이상 징후
- 12:00-13:00: L1 gas price spike (150 gwei, normally 45)
- 14:30: op-batcher batch submission 실패 3회
- 16:00: 정상화

### 비용 분석
- 2vCPU 운영 시간: 18시간 (총 비용 $0.1676)
- 4vCPU 운영 시간: 6시간 (총 비용 $0.1115)
- 일일 총 비용: $0.2791

보고서를 작성해주세요.`,
  expectedOutputType: 'markdown',
  validationFn: (content: string) => {
    // Markdown validation: must contain headers and Korean text
    return (
      content.includes('#') &&
      /[\u4E00-\u9FFF\uAC00-\uD7AF]/g.test(content) &&
      content.includes('요약')
    );
  },
};

/**
 * NLOps Responder: Natural language response generation
 * Tier: fast | Output: Text
 */
const NLOPS_RESPONDER: PromptDefinition = {
  id: 'nlops-responder',
  tier: 'fast',
  description: 'Natural language operation response',
  systemPrompt: `You are a helpful assistant for SentinAI, an Optimism L2 node monitoring system.

Your task is to convert structured data into natural, friendly responses.

## Guidelines
1. Be concise but informative
2. Format numbers nicely (e.g., 1,234 instead of 1234)
3. Include relevant metrics and status information
4. If an action failed, explain why and suggest alternatives
5. Use a professional but friendly tone

## Formatting
- Use bullet points for lists
- Keep responses under 200 words
- Don't use markdown headers (# or ##)

## Response Structure
1. Main status/result
2. Key metrics (if applicable)
3. Brief explanation or next steps (if applicable)`,
  userPrompt: `Generate a response for cost optimization recommendations:

Intent: Cost optimizer analysis
Result data:
{
  "recommendations": [
    {
      "type": "downscale",
      "title": "Scale down during low-traffic hours",
      "description": "Reduce from 2vCPU to 1vCPU between 00:00-06:00 UTC",
      "currentCost": 0.1234,
      "projectedCost": 0.0891,
      "savingsPercent": 27.8,
      "confidence": 0.92,
      "risk": "low"
    },
    {
      "type": "schedule",
      "title": "Right-size vCPU tier",
      "description": "Use 1vCPU for baseline, 2vCPU only during 12:00-18:00",
      "currentCost": 0.2791,
      "projectedCost": 0.1834,
      "savingsPercent": 34.3,
      "confidence": 0.85,
      "risk": "medium"
    }
  ],
  "insight": "Current over-provisioning costs $0.0957/day. Implement scheduling strategy."
}

Format as a friendly, actionable response that a DevOps engineer would understand.`,
  expectedOutputType: 'text',
  validationFn: (content: string) => {
    // Text validation: must be non-empty string with reasonable length
    return content.length > 50 && content.length < 2000;
  },
};

/**
 * All prompts for benchmarking
 */
export const BENCHMARK_PROMPTS: PromptDefinition[] = [
  PREDICTIVE_SCALER,
  ANOMALY_ANALYZER,
  RCA_ENGINE,
  DAILY_REPORT,
  NLOPS_RESPONDER,
];

/**
 * Get prompt by ID
 */
export function getPromptById(id: string): PromptDefinition | undefined {
  return BENCHMARK_PROMPTS.find(p => p.id === id);
}

/**
 * Get all prompts for a specific tier
 */
export function getPromptsByTier(tier: 'fast' | 'best'): PromptDefinition[] {
  return BENCHMARK_PROMPTS.filter(p => p.tier === tier);
}
