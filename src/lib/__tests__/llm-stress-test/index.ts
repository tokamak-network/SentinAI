import fs from 'fs/promises';
import path from 'path';
import { LLMClientWrapper, createClientsForAllProviders } from './models/client-wrapper';
import { FastTierScenario } from './scenarios/fast-tier';
import { BestTierScenario } from './scenarios/best-tier';
import { MixedWorkloadScenario } from './scenarios/mixed-workload';
import { ResultFormatter } from './utils/result-formatter';
import type { AIProvider, ModelTier } from '@/lib/ai-client';
import type { TestConfig } from './types';

/**
 * Load orchestrator configuration from environment variables
 */
function loadOrchestratorConfig(): Partial<TestConfig> {
  const providersEnv = process.env.LLM_TEST_PROVIDERS;
  const outputDirEnv = process.env.LLM_TEST_OUTPUT_DIR;

  const config: Partial<TestConfig> = {};

  if (providersEnv) {
    config.providers = providersEnv
      .split(',')
      .map(p => p.trim() as AIProvider);
  }

  if (outputDirEnv) {
    config.outputDir = outputDirEnv;
  }

  return config;
}

/**
 * LLM Stress Test Orchestrator
 * Coordinates test execution across all scenarios and providers
 *
 * Usage:
 *   npx tsx src/lib/__tests__/llm-stress-test/index.ts
 *
 * Environment Variables:
 *   LLM_TEST_PROVIDERS=qwen,anthropic,openai,gemini  # Comma-separated providers
 *   LLM_TEST_TIMEOUT_FAST=30000                      # Fast-tier timeout (ms)
 *   LLM_TEST_TIMEOUT_BEST=60000                      # Best-tier timeout (ms)
 *   LLM_TEST_OUTPUT_DIR=src/lib/__tests__/llm-stress-test/output  # Result directory
 *
 * Output:
 *   src/lib/__tests__/llm-stress-test/output/
 *   ├── report-YYYY-MM-DDTHH-mm-ss.md
 *   └── results-YYYY-MM-DDTHH-mm-ss.json
 */
export class LLMStressTestOrchestrator {
  private clients: LLMClientWrapper[] = [];
  private scenarios = [
    new FastTierScenario(),
    new BestTierScenario(),
    new MixedWorkloadScenario(),
  ];
  private outputDir: string;

  constructor(config: Partial<TestConfig> = {}) {
    // Merge environment variables with provided config
    const envConfig = loadOrchestratorConfig();
    const mergedConfig = { ...envConfig, ...config };

    const providers = mergedConfig.providers ?? (['qwen', 'anthropic', 'openai', 'gemini'] as AIProvider[]);
    const tiers = mergedConfig.tiers ?? (['fast', 'best'] as ModelTier[]);

    this.clients = createClientsForAllProviders(providers, tiers);
    this.outputDir = mergedConfig.outputDir ?? path.join(
      process.cwd(),
      'src/lib/__tests__/llm-stress-test/output'
    );

    console.info(`✅ Initialized ${this.clients.length} clients`);
    console.info(`   Providers: ${providers.join(', ')}`);
    console.info(`   Tiers: ${tiers.join(', ')}`);
    console.info(`   Output directory: ${this.outputDir}`);
  }

  /**
   * Run all scenarios and save results
   */
  async runAll(): Promise<void> {
    console.info('\n🚀 Starting LLM Stress Tests...\n');
    console.info(`Clients: ${this.clients.length}`);
    console.info(`Scenarios: ${this.scenarios.length}\n`);

    const allResults: any[] = [];
    const startTime = Date.now();

    for (const scenario of this.scenarios) {
      console.info(`▶️  Running: ${scenario.name}`);
      const scenarioStartTime = Date.now();

      try {
        const results = await scenario.run(this.clients);
        allResults.push(...results);

        const scenarioDuration = ((Date.now() - scenarioStartTime) / 1000).toFixed(1);
        console.info(`✅ Completed: ${results.length} results in ${scenarioDuration}s\n`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed: ${errorMsg}\n`);
      }
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.info(`\n📊 All tests completed in ${totalDuration}s\n`);

    // Save results
    await this.saveResults(allResults);
  }

  /**
   * Save results to Markdown and JSON files
   */
  private async saveResults(results: any[]): Promise<void> {
    // Ensure output directory exists
    await fs.mkdir(this.outputDir, { recursive: true });

    const formatter = new ResultFormatter();
    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, '-')
      .split('.')[0];

    // Generate reports
    const markdownReport = formatter.formatComprehensiveReport(results);
    const jsonReport = formatter.formatJSON(results);

    // Write Markdown report
    const reportPath = path.join(this.outputDir, `report-${timestamp}.md`);
    await fs.writeFile(reportPath, markdownReport, 'utf8');
    console.info(`  📄 ${path.relative(process.cwd(), reportPath)}`);

    // Write JSON results
    const jsonPath = path.join(this.outputDir, `results-${timestamp}.json`);
    await fs.writeFile(jsonPath, jsonReport, 'utf8');
    console.info(`  📄 ${path.relative(process.cwd(), jsonPath)}`);

    // Summary
    const totalRequests = results.reduce((s: number, r: any) => s + r.totalRequests, 0);
    const totalCost = results.reduce((s: number, r: any) => s + r.totalCostUsd, 0);
    const avgAccuracy = results.reduce((s: number, r: any) => s + r.accuracy, 0) / results.length;

    console.info(`\n📈 Summary:`);
    console.info(`  Total requests: ${totalRequests.toLocaleString()}`);
    console.info(`  Total cost: $${totalCost.toFixed(2)}`);
    console.info(`  Average accuracy: ${avgAccuracy.toFixed(1)}%`);
  }
}

/**
 * CLI Entry Point
 */
if (require.main === module) {
  const orchestrator = new LLMStressTestOrchestrator({
    providers: ['qwen', 'anthropic', 'openai', 'gemini'],
    tiers: ['fast', 'best'],
  });

  orchestrator.runAll().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

export default LLMStressTestOrchestrator;
