import { BaseScenario } from './base';
import { FastTierScenario } from './fast-tier';
import { BestTierScenario } from './best-tier';
import type { LLMClientWrapper } from '../models/client-wrapper';
import type { ScenarioResult, TestDataPair } from '../types';

/**
 * Mixed Workload Scenario: Real Production Pattern
 *
 * Simulates realistic SentinAI load: 80% fast-tier + 20% best-tier
 * Based on actual feature usage:
 * - 5 fast-tier features: intent classification, log analysis, anomaly L2, predictor, responder
 * - 3 best-tier features: RCA, cost optimizer, daily report
 *
 * Typical load per hour:
 * - Fast-tier: 240 calls
 * - Best-tier: 60 calls
 * - Concurrent: up to 10 simultaneous
 */
export class MixedWorkloadScenario extends BaseScenario {
  readonly name = 'Real Production: 80% fast + 20% best';

  readonly config = {
    testLoads: [
      { name: 'production_1h', requests: 300, parallelism: 10 },
    ],
    inputTokenRange: [500, 5000] as [number, number],
    expectedOutputTokens: 300,
  };

  /**
   * Override run() to use delegated scenarios
   * Instead of sequential execution, we compose fast + best scenarios
   */
  async run(clients: LLMClientWrapper[]): Promise<ScenarioResult[]> {
    const fastScenario = new FastTierScenario();
    const bestScenario = new BestTierScenario();

    // Separate clients by tier
    const fastClients = clients.filter(c => {
      const info = c['getInfo']?.();
      return info?.tier === 'fast';
    });

    const bestClients = clients.filter(c => {
      const info = c['getInfo']?.();
      return info?.tier === 'best';
    });

    // Execute both scenarios in parallel for better wall-clock time
    const [fastResults, bestResults] = await Promise.all([
      fastScenario.run(fastClients),
      bestScenario.run(bestClients),
    ]);

    return [...fastResults, ...bestResults];
  }

  /**
   * Not used in this scenario (delegated to FastTierScenario + BestTierScenario)
   */
  generateTestData(_count: number): TestDataPair[] {
    void _count;
    return [];
  }

  /**
   * Not used in this scenario
   */
  calculateAccuracy(): number {
    return 0;
  }

  /**
   * Not used in this scenario
   */
  protected async invokeClient(): Promise<any> {
    throw new Error('Not implemented - use run() instead');
  }
}
