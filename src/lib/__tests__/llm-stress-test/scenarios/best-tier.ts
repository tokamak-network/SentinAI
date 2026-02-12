import { BaseScenario } from './base';
import type { LLMClientWrapper } from '../models/client-wrapper';
import type { InvokeResult } from '../types';

/**
 * Best-Tier Scenario: Root Cause Analysis (RCA)
 *
 * Tests complex reasoning tasks requiring high accuracy
 * Typical use case: RCA, cost optimization, daily reports
 *
 * Input: 3000-5000 tokens (metrics + dependency graph + timeline)
 * Output: JSON RCA with root_cause, contributing_factors, confidence
 * Expected latency: <2000ms P95, >90% accuracy
 */
export class BestTierScenario extends BaseScenario {
  readonly name = 'Best-Tier: Root Cause Analysis';

  readonly config = {
    testLoads: [
      { name: 'quality', requests: 50, parallelism: 1 },
      { name: 'stability', requests: 50, parallelism: 5 },
    ],
    inputTokenRange: [3000, 5000] as [number, number],
    expectedOutputTokens: 500,
  };

  /**
   * Generate realistic RCA scenarios
   */
  generateTestData(count: number) {
    return Array.from({ length: count }, () => ({
      input: this.generateRCAScenario(),
      expected: { root_cause: 'string', confidence: 0.0 },
    }));
  }

  /**
   * Generate realistic RCA problem statement
   */
  private generateRCAScenario(): string {
    const scenarios = [
      {
        title: 'RPC Timeout Cascade',
        timeline: [
          'T+0s: L1 RPC endpoint reports 429 (rate limit)',
          'T+5s: op-node switches to backup endpoint',
          'T+10s: Block processing delay increases (8s → 20s)',
          'T+15s: op-batcher pending count grows (100 → 2000)',
          'T+20s: Node sync lag detected (0.5 blocks → 5 blocks)',
          'T+30s: K8s pod restart triggered by liveness probe',
        ],
      },
      {
        title: 'Memory Pressure',
        timeline: [
          'T+0s: Memory usage steady (60%)',
          'T+5s: State cache grows unexpectedly (300MB → 800MB)',
          'T+10s: GC pause increases (50ms → 500ms)',
          'T+15s: Block processing delayed by GC',
          'T+20s: CPU spike due to memory compaction',
          'T+30s: Pod restart after OOMKilled event',
        ],
      },
      {
        title: 'Dependency Graph Failure',
        timeline: [
          'T+0s: op-geth RPC connection lost',
          'T+5s: op-node awaiting geth availability',
          'T+10s: Block retrieval fails (5 consecutive retries)',
          'T+15s: Chain tip diverges from sequencer',
          'T+20s: Derivation process stalls',
          'T+30s: Operator manual intervention required',
        ],
      },
    ];

    const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];

    return `
## Incident: ${scenario.title}

### Failure Timeline
${scenario.timeline.map(line => `- ${line}`).join('\n')}

### Component Dependencies
- L1 Blockchain → op-node (RPC)
- op-node → op-geth (execution)
- op-geth → State DB (disk)
- op-batcher → L1 (transactions)
- op-proposer → L1 (output roots)

### Metrics
- L2 Block Time: Normal (2s) → Degraded (20s)
- TxPool Backlog: Normal (50) → Critical (5000)
- CPU: Normal (30%) → Peak (95%)
- Memory: Normal (60%) → Peak (95%)
- Sync Lag: Normal (0.5) → Critical (50 blocks)

### Known Facts
- Other L2 nodes operating normally
- L1 network healthy (gas prices normal)
- No pod crashes before T+30s
- Backup systems not triggered automatically

Please provide:
1. Root cause analysis (most likely failure point)
2. Contributing factors (secondary issues)
3. Recommendation (how to prevent)
4. Confidence level (0.0-1.0)
`;
  }

  /**
   * Invoke LLM with RCA prompt
   */
  protected async invokeClient(
    client: LLMClientWrapper,
    input: string
  ): Promise<InvokeResult> {
    const systemPrompt =
      'You are an expert L2 node infrastructure engineer with deep knowledge of Optimism architecture. ' +
      'Analyze incident timelines and provide root cause analysis. ' +
      'Respond with valid JSON only: {"root_cause": "...", "contributing_factors": [...], "recommendation": "...", "confidence": 0.0}';

    const userPrompt = `Analyze this incident:\n\n${input}\n\nProvide RCA in JSON format.`;

    // Use environment variable timeout if set, otherwise default 60s
    const timeout = parseInt(process.env.LLM_TEST_TIMEOUT_BEST || '60000', 10);

    return client.invoke(systemPrompt, userPrompt, {
      maxTokens: 1000,
      timeout,
    });
  }

  /**
   * Calculate accuracy: valid JSON with required RCA fields
   */
  calculateAccuracy(results: InvokeResult[]): number {
    if (results.length === 0) return 0;

    const valid = results.filter(r => {
      try {
        const parsed = JSON.parse(r.text);
        return (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof parsed.root_cause === 'string' &&
          parsed.root_cause.length > 0 &&
          Array.isArray(parsed.contributing_factors) &&
          typeof parsed.recommendation === 'string' &&
          typeof parsed.confidence === 'number' &&
          parsed.confidence >= 0 &&
          parsed.confidence <= 1
        );
      } catch {
        return false;
      }
    }).length;

    return (valid / results.length) * 100;
  }
}
