import type { LLMClientWrapper } from '../models/client-wrapper';
import type { InvokeResult, ScenarioResult, TestDataPair, TestLoad } from '../types';

/**
 * Base class for all test scenarios
 * Defines interface and common orchestration logic
 */
export abstract class BaseScenario {
  abstract readonly name: string;

  abstract readonly config: {
    testLoads: TestLoad[];
    inputTokenRange: [number, number];
    expectedOutputTokens: number;
  };

  /**
   * Generate test data for this scenario
   */
  abstract generateTestData(count: number): TestDataPair[];

  /**
   * Calculate accuracy of responses
   * Returns percentage 0-100
   */
  abstract calculateAccuracy(results: InvokeResult[]): number;

  /**
   * Make actual LLM call for single test case
   */
  protected abstract invokeClient(
    client: LLMClientWrapper,
    input: string
  ): Promise<InvokeResult>;

  /**
   * Run all test loads for all clients
   */
  async run(clients: LLMClientWrapper[]): Promise<ScenarioResult[]> {
    const allResults: ScenarioResult[] = [];

    for (const testLoad of this.config.testLoads) {
      for (const client of clients) {
        const result = await this.executeLoad(client, testLoad);
        allResults.push(result);
      }
    }

    return allResults;
  }

  /**
   * Execute single test load (with parallelism)
   */
  private async executeLoad(
    client: LLMClientWrapper,
    testLoad: TestLoad
  ): Promise<ScenarioResult> {
    const testData = this.generateTestData(testLoad.requests);
    const results: InvokeResult[] = [];
    const startTime = Date.now();

    // Execute in batches with specified parallelism
    for (let i = 0; i < testData.length; i += testLoad.parallelism) {
      const batch = testData.slice(i, i + testLoad.parallelism);
      const batchResults = await Promise.all(
        batch.map(data => this.invokeClient(client, data.input))
      );
      results.push(...batchResults);
    }

    const duration = Date.now() - startTime;
    return this.aggregateResults(client, results, testLoad, duration);
  }

  /**
   * Aggregate individual results into scenario-level metrics
   */
  private aggregateResults(
    client: LLMClientWrapper,
    results: InvokeResult[],
    testLoad: TestLoad,
    duration: number
  ): ScenarioResult {
    const successful = results.filter(r => !r.error);
    const failed = results.filter(r => r.error);

    const latencies = successful.map(r => r.latencyMs);
    const latencyStats = this.calculateLatencyStats(latencies);
    const totalCost = successful.reduce((sum, r) => sum + r.costUsd, 0);

    const info = client['getInfo']?.() || { provider: 'unknown', tier: 'fast' };

    return {
      scenario: this.name,
      provider: info.provider,
      tier: info.tier,
      testLoad: testLoad.name,
      totalRequests: results.length,
      successfulRequests: successful.length,
      failedRequests: failed.length,

      avgLatencyMs: latencyStats.mean,
      p50LatencyMs: latencyStats.p50,
      p95LatencyMs: latencyStats.p95,
      p99LatencyMs: latencyStats.p99,

      avgCostPerRequest: successful.length > 0 ? totalCost / successful.length : 0,
      totalCostUsd: totalCost,

      accuracy: this.calculateAccuracy(successful),

      duration,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Calculate percentile-based latency statistics
   * Reuses pattern from metrics-store.ts
   */
  protected calculateLatencyStats(latencies: number[]) {
    if (latencies.length === 0) {
      return {
        mean: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      };
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const mean = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;

    const percentile = (arr: number[], p: number) => {
      const index = Math.floor(arr.length * p);
      return arr[index];
    };

    return {
      mean,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
    };
  }
}
