import { BaseScenario } from './base';
import type { LLMClientWrapper } from '../models/client-wrapper';
import type { InvokeResult, TestLoad } from '../types';

/**
 * Fast-Tier Scenario: Log Analysis + Anomaly Detection
 *
 * Tests high-volume, low-latency tasks suitable for fast-tier models
 * Typical use case: Intent classification, log analysis, anomaly L2 analysis
 *
 * Input: 500-2000 token log chunks
 * Output: JSON severity classification (low/medium/high)
 * Expected latency: <600ms P95
 */
export class FastTierScenario extends BaseScenario {
  readonly name = 'Fast-Tier: Log Analysis + Anomaly Detection';

  readonly config = {
    testLoads: [
      { name: 'sequential', requests: 100, parallelism: 1 },
      { name: 'throughput', requests: 100, parallelism: 10 },
      { name: 'endurance', requests: 1000, parallelism: 3 },
    ],
    inputTokenRange: [500, 2000] as [number, number],
    expectedOutputTokens: 200,
  };

  /**
   * Generate realistic log chunks for testing
   * Simulates actual L2 node logs with various failure patterns
   */
  generateTestData(count: number) {
    return Array.from({ length: count }, () => ({
      input: this.generateLogChunk(),
      expected: { severity: 'low' as const },
    }));
  }

  /**
   * Generate realistic L2 node log chunk
   */
  private generateLogChunk(): string {
    const templates = [
      '[{time}] ERROR: RPC timeout after 5s\n[{time}] WARN: CPU spike to {cpu}%\n[{time}] INFO: Request recovered',
      '[{time}] INFO: TxPool {from}→{to} pending\n[{time}] ERROR: K8s pod restart initiated\n[{time}] WARN: Sync lag detected',
      '[{time}] WARN: Memory usage {mem}%\n[{time}] INFO: Block interval {interval}s\n[{time}] DEBUG: Reorg detected',
      '[{time}] ERROR: L1 RPC connection failed\n[{time}] WARN: Fallback to secondary endpoint\n[{time}] INFO: Connection restored',
      '[{time}] INFO: New block {block} finalized\n[{time}] DEBUG: State root mismatch\n[{time}] ERROR: Recompiling state',
    ];

    const template = templates[Math.floor(Math.random() * templates.length)] ?? templates[0];
    return template
      .replace(/{time}/g, new Date().toISOString())
      .replace(/{cpu}/g, Math.floor(Math.random() * 100).toString())
      .replace(/{mem}/g, Math.floor(Math.random() * 100).toString())
      .replace(/{from}/g, Math.floor(Math.random() * 500).toString())
      .replace(/{to}/g, Math.floor(Math.random() * 5000).toString())
      .replace(/{interval}/g, String((Math.random() * 10 + 5).toFixed(1)))
      .replace(/{block}/g, Math.floor(Math.random() * 1000000).toString());
  }

  /**
   * Invoke LLM with log analysis prompt
   */
  protected async invokeClient(
    client: LLMClientWrapper,
    input: string
  ): Promise<InvokeResult> {
    const systemPrompt =
      'You are an expert L2 node log analyzer. Analyze the provided log chunk and classify its severity level. ' +
      'Respond with valid JSON only: {"severity": "low"|"medium"|"high", "reasoning": "..."}';

    const userPrompt = `Analyze this log chunk:\n\n${input}\n\nClassify severity and provide JSON response.`;

    // Use environment variable timeout if set, otherwise default 30s
    const timeout = parseInt(process.env.LLM_TEST_TIMEOUT_FAST || '30000', 10);

    return client.invoke(systemPrompt, userPrompt, {
      maxTokens: 300,
      timeout,
    });
  }

  /**
   * Calculate accuracy: valid JSON with severity field
   */
  calculateAccuracy(results: InvokeResult[]): number {
    if (results.length === 0) return 0;

    const valid = results.filter(r => {
      try {
        const parsed = JSON.parse(r.text);
        return (
          typeof parsed === 'object' &&
          parsed !== null &&
          ['low', 'medium', 'high'].includes(parsed.severity) &&
          typeof parsed.reasoning === 'string'
        );
      } catch {
        return false;
      }
    }).length;

    return (valid / results.length) * 100;
  }
}
