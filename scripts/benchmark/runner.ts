/**
 * Benchmark Runner
 * Executes prompts against multiple models and collects results
 */

import chalk from 'chalk';
import { chatCompletion } from '@/lib/ai-client';
import type { AIProvider } from '@/lib/ai-client';
import type { BenchmarkResult, AggregatedResult } from './types';
import type { ModelDef } from './models-config';
import { BENCHMARK_PROMPTS } from './prompts';
import { tsConsole } from '../console-with-timestamp';

/**
 * Run single benchmark test for a specific model
 */
async function runSingleTest(
  model: ModelDef,
  promptId: string,
  iteration: number,
  timeoutMs: number
): Promise<BenchmarkResult> {
  const prompt = BENCHMARK_PROMPTS.find(p => p.id === promptId)!;

  try {
    const controller = new AbortController();
    let timeoutHandle: NodeJS.Timeout | null = null;

    if (timeoutMs) {
      timeoutHandle = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
    }

    const startTime = Date.now();

    const result = await chatCompletion({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      modelTier: model.tier,
      modelName: model.modelName,
      maxTokens: 4096,
      signal: controller.signal,
    });

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    const latencyMs = Date.now() - startTime;
    const tokensIn = result.usage?.promptTokens ?? 0;
    const tokensOut = result.usage?.completionTokens ?? 0;

    // Calculate cost based on model pricing
    const costUsd = (tokensIn * model.pricing.inputCost + tokensOut * model.pricing.outputCost) / 1_000_000;

    // Validate response
    const accuracy = prompt.validationFn(result.content) ? 1 : 0;

    return {
      promptId,
      modelId: model.id,
      provider: result.provider,
      tier: prompt.tier,
      iteration,
      latencyMs,
      tokensIn,
      tokensOut,
      costUsd,
      accuracy,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Log detailed error for debugging
    if (process.env.DEBUG_BENCHMARK) {
      tsConsole.error(`  [DEBUG] ${model.id}/${promptId} error:`, errorMsg);
    }
    return {
      promptId,
      modelId: model.id,
      provider: model.provider,
      tier: prompt.tier,
      iteration,
      latencyMs: 0,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      accuracy: 0,
      error: errorMsg,
    };
  }
}

/**
 * Run benchmarks for all models and prompts
 * Supports both traditional provider-based and model-specific configurations
 */
export async function runAllBenchmarks(config: {
  providers?: AIProvider[];
  models?: ModelDef[];
  iterations: number;
  timeoutFast: number;
  timeoutBest: number;
}): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // Determine models to test
  let modelsToTest: ModelDef[];
  if (config.models && config.models.length > 0) {
    modelsToTest = config.models;
  } else if (config.providers && config.providers.length > 0) {
    // Fallback to legacy provider-based mode (not fully supported with new system)
    throw new Error('Provider-based benchmarking is deprecated. Use models instead.');
  } else {
    throw new Error('Either models or providers must be specified');
  }

  const totalTests = BENCHMARK_PROMPTS.length * modelsToTest.length * config.iterations;

  tsConsole.log(
    chalk.cyan(`\n🚀 Starting benchmarks (${totalTests} total tests)\n`)
  );

  let completed = 0;

  for (const prompt of BENCHMARK_PROMPTS) {
    tsConsole.log(
      chalk.yellow(`\n▶ Prompt: ${prompt.id} (${prompt.tier} tier)`)
    );

    for (const model of modelsToTest) {
      tsConsole.log(chalk.gray(`  Model: ${model.id} (${model.description})`));

      const timeout = model.tier === 'fast' ? config.timeoutFast : config.timeoutBest;

      for (let i = 1; i <= config.iterations; i++) {
        const result = await runSingleTest(
          model,
          prompt.id,
          i,
          timeout
        );

        results.push(result);
        completed++;

        // Progress indicator
        const progressPct = Math.round((completed / totalTests) * 100);
        const statusIcon = result.error ? '❌' : '✓';
        const accuracy = result.accuracy === 1 ? '100%' : '0%';

        process.stdout.write(
          chalk.gray(
            `    [${progressPct}%] ${statusIcon} ` +
            `${result.latencyMs}ms | ` +
            `$${result.costUsd.toFixed(4)} | ` +
            `${accuracy}\n`
          )
        );

        // Sleep 1 second to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  tsConsole.log(chalk.green(`\n✅ All benchmarks completed!\n`));
  return results;
}

/**
 * Aggregate results by prompt/model
 */
export function aggregateResults(results: BenchmarkResult[]): AggregatedResult[] {
  const groups = new Map<string, BenchmarkResult[]>();

  // Group by prompt/model
  for (const result of results) {
    const key = `${result.promptId}|${result.modelId}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(result);
  }

  // Calculate aggregates
  const aggregated: AggregatedResult[] = [];
  for (const [, group] of groups) {
    if (group.length === 0) continue;

    const first = group[0];
    const successful = group.filter(r => !r.error);
    const latencies = successful.map(r => r.latencyMs).sort((a, b) => a - b);
    const accuracy = group.filter(r => r.accuracy === 1).length / group.length;

    aggregated.push({
      promptId: first.promptId,
      modelId: first.modelId,
      provider: first.provider,
      tier: first.tier,
      totalIterations: group.length,
      successfulIterations: successful.length,
      avgLatencyMs: latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0,
      p95LatencyMs: latencies.length > 0
        ? latencies[Math.ceil(latencies.length * 0.95) - 1] || 0
        : 0,
      avgCostUsd: group.reduce((a, r) => a + r.costUsd, 0) / group.length,
      totalCostUsd: group.reduce((a, r) => a + r.costUsd, 0),
      accuracy,
    });
  }

  return aggregated;
}

/**
 * Print detailed results table
 */
export function printResults(
  results: BenchmarkResult[],
  aggregated: AggregatedResult[]
): void {
  // Summary stats
  const successful = results.filter(r => !r.error);
  const totalCost = results.reduce((a, r) => a + r.costUsd, 0);
  const avgAccuracy = results.filter(r => r.accuracy === 1).length / results.length;

  tsConsole.log(chalk.bold('\n📊 Benchmark Summary\n'));
  tsConsole.log(`Total Tests: ${results.length}`);
  tsConsole.log(`Success: ${successful.length} | Failed: ${results.length - successful.length}`);
  tsConsole.log(`Total Cost: $${totalCost.toFixed(4)}`);
  tsConsole.log(`Average Accuracy: ${(avgAccuracy * 100).toFixed(1)}%\n`);

  // Detailed breakdown
  tsConsole.log(chalk.bold('Per-Prompt Breakdown\n'));

  for (const prompt of BENCHMARK_PROMPTS) {
    const promptResults = aggregated.filter(r => r.promptId === prompt.id);
    if (promptResults.length === 0) continue;

    tsConsole.log(chalk.cyan(`${prompt.id} (${prompt.tier} tier)`));
    tsConsole.log('┌───────────────────┬─────────┬─────────┬──────────┬─────────────┐');
    tsConsole.log('│ Model             │ Avg(ms) │ P95(ms) │ Cost($)  │ Accuracy(%) │');
    tsConsole.log('├───────────────────┼─────────┼─────────┼──────────┼─────────────┤');

    for (const result of promptResults) {
      const modelLabel = result.modelId.padEnd(17);
      const avg = result.avgLatencyMs.toFixed(0).padStart(7);
      const p95 = result.p95LatencyMs.toFixed(0).padStart(7);
      const cost = result.avgCostUsd.toFixed(5).padStart(8);
      const accuracy = (result.accuracy * 100).toFixed(0).padStart(11);

      tsConsole.log(
        `│ ${modelLabel} │ ${avg} │ ${p95} │ ${cost} │ ${accuracy} │`
      );
    }

    tsConsole.log('└───────────────────┴─────────┴─────────┴──────────┴─────────────┘\n');
  }

  // Top performers
  tsConsole.log(chalk.bold('🏆 Top Performers\n'));

  const byLatency = [...aggregated].sort(
    (a, b) => a.avgLatencyMs - b.avgLatencyMs
  ).slice(0, 3);
  const byCost = [...aggregated].sort(
    (a, b) => a.avgCostUsd - b.avgCostUsd
  ).slice(0, 3);
  const byAccuracy = [...aggregated].sort(
    (a, b) => b.accuracy - a.accuracy
  ).slice(0, 3);

  tsConsole.log('Fastest:');
  for (const r of byLatency) {
    tsConsole.log(`  ${r.modelId} (${r.avgLatencyMs.toFixed(0)}ms)`);
  }

  tsConsole.log('\nCheapest:');
  for (const r of byCost) {
    tsConsole.log(
      `  ${r.modelId} ($${r.avgCostUsd.toFixed(5)}/req)`
    );
  }

  tsConsole.log('\nMost Accurate:');
  for (const r of byAccuracy) {
    tsConsole.log(`  ${r.modelId} (${(r.accuracy * 100).toFixed(1)}%)`);
  }

  tsConsole.log();
}
