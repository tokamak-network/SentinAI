/**
 * Benchmark Reporter
 * Generates Markdown report with model-level aggregation,
 * tier-aware analysis, and failure-excluded rankings.
 */

import fs from 'fs/promises';
import path from 'path';
import type { BenchmarkResult, AggregatedResult } from './types';

// ============================================================
// Helpers
// ============================================================

/** Aggregate results by model (across all prompts) */
function aggregateByModel(aggregated: AggregatedResult[]): {
  modelId: string;
  provider: string;
  totalTests: number;
  successTests: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgCostUsd: number;
  totalCostUsd: number;
  accuracy: number;
}[] {
  const modelMap = new Map<string, AggregatedResult[]>();
  for (const r of aggregated) {
    if (!modelMap.has(r.modelId)) modelMap.set(r.modelId, []);
    modelMap.get(r.modelId)!.push(r);
  }

  return [...modelMap.entries()].map(([modelId, entries]) => {
    const successful = entries.filter(e => e.successfulIterations > 0);
    const totalTests = entries.reduce((s, e) => s + e.totalIterations, 0);
    const successTests = entries.reduce((s, e) => s + e.successfulIterations, 0);
    const latencies = successful.map(e => e.avgLatencyMs);
    const p95s = successful.map(e => e.p95LatencyMs);

    return {
      modelId,
      provider: entries[0].provider,
      totalTests,
      successTests,
      successRate: totalTests > 0 ? successTests / totalTests : 0,
      avgLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      p95LatencyMs: p95s.length > 0 ? Math.max(...p95s) : 0,
      avgCostUsd: successful.length > 0 ? successful.reduce((s, e) => s + e.avgCostUsd, 0) / successful.length : 0,
      totalCostUsd: entries.reduce((s, e) => s + e.totalCostUsd, 0),
      accuracy: entries.length > 0 ? entries.reduce((s, e) => s + e.accuracy, 0) / entries.length : 0,
    };
  });
}

/** Filter to only successful results for ranking purposes */
function successOnly(arr: AggregatedResult[]): AggregatedResult[] {
  return arr.filter(r => r.successfulIterations > 0 && r.accuracy > 0);
}

// ============================================================
// Report Generation
// ============================================================

/**
 * Generate Markdown report
 */
export async function generateMarkdownReport(
  results: BenchmarkResult[],
  aggregated: AggregatedResult[],
  outputDir: string
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `${timestamp}.md`;
  const filepath = path.join(outputDir, filename);

  const successful = results.filter(r => !r.error);
  const failed = results.filter(r => !!r.error);
  const totalCost = results.reduce((a, r) => a + r.costUsd, 0);
  const duration = new Date().toLocaleString();

  // Unique providers and models
  const providers = [...new Set(results.map(r => r.provider))];
  const models = [...new Set(results.map(r => r.modelId))];

  let md = `# Model Benchmark Report

**Generated**: ${duration}

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Tests | ${results.length} (${models.length} models × ${[...new Set(results.map(r => r.promptId))].length} prompts) |
| Success Rate | ${((successful.length / results.length) * 100).toFixed(1)}% (${successful.length}/${results.length}) |
| Failures | ${failed.length > 0 ? failed.length + ' — ' + [...new Set(failed.map(r => r.modelId))].join(', ') : 'None'} |
| Total Cost | $${totalCost.toFixed(4)} |
| Providers | ${providers.join(', ')} |

`;

  // ============================================================
  // Model-Level Overall Rankings (NEW)
  // ============================================================

  const modelStats = aggregateByModel(aggregated);

  // Sort by composite: speed (40%) + cost (30%) + reliability (30%), failures excluded from speed/cost
  const ranked = [...modelStats]
    .filter(m => m.successRate > 0)
    .sort((a, b) => {
      // Normalize each dimension to 0-1 range
      const maxLat = Math.max(...modelStats.filter(m => m.avgLatencyMs > 0).map(m => m.avgLatencyMs));
      const maxCost = Math.max(...modelStats.filter(m => m.avgCostUsd > 0).map(m => m.avgCostUsd));

      const latA = maxLat > 0 ? a.avgLatencyMs / maxLat : 0;
      const latB = maxLat > 0 ? b.avgLatencyMs / maxLat : 0;
      const costA = maxCost > 0 ? a.avgCostUsd / maxCost : 0;
      const costB = maxCost > 0 ? b.avgCostUsd / maxCost : 0;
      const relA = 1 - a.successRate;
      const relB = 1 - b.successRate;

      const scoreA = latA * 0.4 + costA * 0.3 + relA * 0.3;
      const scoreB = latB * 0.4 + costB * 0.3 + relB * 0.3;
      return scoreA - scoreB;
    });

  md += `## Model Rankings (Overall)\n\n`;
  md += `> Ranked by composite score: speed (40%) + cost (30%) + reliability (30%). Failed tests excluded from speed/cost calculation.\n\n`;
  md += `| Rank | Model | Provider | Avg Latency | Avg Cost | Success | Accuracy |\n`;
  md += `|------|-------|----------|-------------|----------|---------|----------|\n`;

  ranked.forEach((r, i) => {
    md += `| ${i + 1} | ${r.modelId} | ${r.provider} | ${r.avgLatencyMs.toFixed(0)}ms | $${r.avgCostUsd.toFixed(5)} | ${r.successTests}/${r.totalTests} | ${(r.accuracy * 100).toFixed(0)}% |\n`;
  });

  // Failed models
  const failedModels = modelStats.filter(m => m.successRate === 0);
  if (failedModels.length > 0) {
    md += `\n**Excluded (all tests failed)**: ${failedModels.map(m => m.modelId).join(', ')}\n`;
  }

  // ============================================================
  // Per-Prompt Analysis (with correct tier label)
  // ============================================================

  md += `\n## Per-Prompt Analysis\n`;

  const promptIds = [...new Set(aggregated.map(r => r.promptId))];

  for (const promptId of promptIds) {
    const promptAgg = aggregated.filter(r => r.promptId === promptId);
    // Get tier from the prompt definition (use first result's tier)
    const tier = promptAgg[0]?.tier ?? 'unknown';

    md += `\n### ${promptId}\n`;
    md += `**Tier**: ${tier}\n\n`;

    md += `| Model | Latency | Cost | Accuracy | Status |\n`;
    md += `|-------|---------|------|----------|--------|\n`;

    for (const r of promptAgg) {
      const isFailed = r.successfulIterations === 0;
      const status = isFailed ? '❌ FAIL' : '✅';
      const latency = isFailed ? '—' : `${r.avgLatencyMs.toFixed(0)}ms`;
      const cost = isFailed ? '—' : `$${r.avgCostUsd.toFixed(5)}`;
      const accuracy = isFailed ? '0%' : `${(r.accuracy * 100).toFixed(0)}%`;
      md += `| ${r.modelId} | ${latency} | ${cost} | ${accuracy} | ${status} |\n`;
    }

    // Recommendations (exclude failures)
    const valid = successOnly(promptAgg);
    if (valid.length > 0) {
      const fastest = [...valid].sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0];
      const cheapest = [...valid].sort((a, b) => a.avgCostUsd - b.avgCostUsd)[0];

      md += `\n`;
      md += `- **Fastest**: ${fastest.modelId} (${fastest.avgLatencyMs.toFixed(0)}ms)\n`;
      md += `- **Cheapest**: ${cheapest.modelId} ($${cheapest.avgCostUsd.toFixed(5)}/req)\n`;
    }
  }

  // ============================================================
  // Top Performers (exclude failures)
  // ============================================================

  md += `\n## Top Performers\n\n`;
  md += `> Only successful tests are considered.\n\n`;

  const validAgg = successOnly(aggregated);

  // Top 3 fastest (unique models)
  const seenFast = new Set<string>();
  const topFast = [...validAgg].sort((a, b) => a.avgLatencyMs - b.avgLatencyMs).filter(r => {
    if (seenFast.has(r.modelId)) return false;
    seenFast.add(r.modelId);
    return true;
  }).slice(0, 5);

  md += `**Fastest** (avg latency):\n`;
  for (const r of topFast) {
    md += `- ${r.modelId}: ${r.avgLatencyMs.toFixed(0)}ms (${r.promptId})\n`;
  }

  // Top 3 cheapest (unique models)
  const seenCheap = new Set<string>();
  const topCheap = [...validAgg].sort((a, b) => a.avgCostUsd - b.avgCostUsd).filter(r => {
    if (seenCheap.has(r.modelId)) return false;
    seenCheap.add(r.modelId);
    return true;
  }).slice(0, 5);

  md += `\n**Cheapest** (avg cost/req):\n`;
  for (const r of topCheap) {
    md += `- ${r.modelId}: $${r.avgCostUsd.toFixed(5)}/req (${r.promptId})\n`;
  }

  // Most reliable (model-level)
  const reliable = [...modelStats].filter(m => m.successRate > 0).sort((a, b) => {
    if (b.successRate !== a.successRate) return b.successRate - a.successRate;
    return a.avgLatencyMs - b.avgLatencyMs; // tie-break by speed
  }).slice(0, 5);

  md += `\n**Most Reliable** (success rate):\n`;
  for (const r of reliable) {
    md += `- ${r.modelId}: ${r.successTests}/${r.totalTests} (${(r.successRate * 100).toFixed(0)}%)\n`;
  }

  // ============================================================
  // Recommendation Summary (NEW)
  // ============================================================

  md += `\n## Recommendation\n\n`;

  // Find best for fast tier
  const fastModels = aggregateByModel(aggregated.filter(r => r.tier === 'fast'));
  const fastBest = [...fastModels]
    .filter(m => m.successRate >= 0.8)
    .sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0];

  // Find best for best tier
  const bestModels = aggregateByModel(aggregated.filter(r => r.tier === 'best'));
  const bestBest = [...bestModels]
    .filter(m => m.successRate >= 0.8)
    .sort((a, b) => {
      // For best tier, weight reliability higher
      const relA = 1 - a.successRate;
      const relB = 1 - b.successRate;
      if (Math.abs(relA - relB) > 0.1) return relA - relB;
      return a.avgLatencyMs - b.avgLatencyMs;
    })[0];

  if (fastBest) {
    md += `| Tier | Recommended Model | Avg Latency | Avg Cost | Success Rate |\n`;
    md += `|------|-------------------|-------------|----------|-------------|\n`;
    md += `| fast | **${fastBest.modelId}** | ${fastBest.avgLatencyMs.toFixed(0)}ms | $${fastBest.avgCostUsd.toFixed(5)}/req | ${(fastBest.successRate * 100).toFixed(0)}% |\n`;
    if (bestBest) {
      md += `| best | **${bestBest.modelId}** | ${bestBest.avgLatencyMs.toFixed(0)}ms | $${bestBest.avgCostUsd.toFixed(5)}/req | ${(bestBest.successRate * 100).toFixed(0)}% |\n`;
    }
  }

  // ============================================================
  // Failure Details
  // ============================================================

  if (failed.length > 0) {
    md += `\n## Failures\n\n`;
    md += `| Model | Prompt | Error |\n`;
    md += `|-------|--------|-------|\n`;

    for (const r of failed) {
      const errMsg = (r.error || 'Unknown').substring(0, 80);
      md += `| ${r.modelId} | ${r.promptId} | ${errMsg} |\n`;
    }
  }

  // ============================================================
  // Footer
  // ============================================================

  md += `\n---\n\n*Generated by SentinAI Model Benchmark* | ${new Date().toISOString()}\n`;

  // Write file
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch {
    // Directory already exists
  }

  await fs.writeFile(filepath, md, 'utf-8');
  return filepath;
}
