/**
 * Benchmark Reporter
 * Generates Markdown report
 */

import fs from 'fs/promises';
import path from 'path';
import type { BenchmarkResult, AggregatedResult } from './types';

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
  const totalCost = results.reduce((a, r) => a + r.costUsd, 0);
  const avgAccuracy =
    results.filter(r => r.accuracy === 1).length / results.length;
  const duration = new Date().toLocaleString();

  let markdown = `# Model Benchmark Report

**Generated**: ${duration}

## Executive Summary

- **Total Tests**: ${results.length}
- **Success Rate**: ${((successful.length / results.length) * 100).toFixed(1)}% (${successful.length}/${results.length})
- **Total Duration**: ~${Math.ceil(results.length * 1.1 / 60)}m
- **Total Cost**: $${totalCost.toFixed(4)}
- **Average Accuracy**: ${(avgAccuracy * 100).toFixed(1)}%

## Overall Rankings

| Rank | Model | Avg Latency (ms) | P95 Latency (ms) | Avg Cost (USD) | Accuracy |
|------|-------|------------------|------------------|----------------|----------|
`;

  // Sort by composite score (latency + cost + accuracy)
  const scored = aggregated.map(r => ({
    ...r,
    score:
      r.avgLatencyMs / 1000 + // normalize to seconds
      r.avgCostUsd * 1000 + // normalize to same scale
      (1 - r.accuracy) * 1000, // penalize inaccuracy
  }));

  const sorted = scored.sort((a, b) => a.score - b.score);

  sorted.slice(0, 10).forEach((r, i) => {
    markdown += `| ${i + 1} | ${r.modelId} | ${r.avgLatencyMs.toFixed(1)} | ${r.p95LatencyMs.toFixed(1)} | $${r.avgCostUsd.toFixed(5)} | ${(r.accuracy * 100).toFixed(1)}% |\n`;
  });

  // Per-prompt analysis
  markdown += `\n## Per-Prompt Analysis\n`;

  const promptIds = [...new Set(aggregated.map(r => r.promptId))];
  for (const promptId of promptIds) {
    const promptResults = aggregated.filter(r => r.promptId === promptId);
    const promptFirstResult = results.find(r => r.promptId === promptId);

    markdown += `\n### ${promptId}\n`;
    markdown += `**Tier**: ${promptFirstResult?.tier ?? 'unknown'}\n\n`;

    markdown += `| Model | Avg Latency | P95 Latency | Cost | Accuracy | Errors |\n`;
    markdown += `|-------|-------------|-------------|------|----------|--------|\n`;

    for (const r of promptResults) {
      const errors = results.filter(
        res => res.promptId === r.promptId && res.modelId === r.modelId && res.error
      ).length;
      markdown += `| ${r.modelId} | ${r.avgLatencyMs.toFixed(1)}ms | ${r.p95LatencyMs.toFixed(1)}ms | $${r.avgCostUsd.toFixed(5)} | ${(r.accuracy * 100).toFixed(1)}% | ${errors > 0 ? `${errors}x` : '-'} |\n`;
    }

    // Best choice for this prompt
    const bestBySpeed = promptResults.sort(
      (a, b) => a.avgLatencyMs - b.avgLatencyMs
    )[0];
    const bestByCost = promptResults.sort(
      (a, b) => a.avgCostUsd - b.avgCostUsd
    )[0];
    const bestByAccuracy = promptResults.sort(
      (a, b) => b.accuracy - a.accuracy
    )[0];

    markdown += `\n**Recommendations**:\n`;
    markdown += `- **Fastest**: ${bestBySpeed.modelId} (${bestBySpeed.avgLatencyMs.toFixed(1)}ms)\n`;
    markdown += `- **Cheapest**: ${bestByCost.modelId} ($${bestByCost.avgCostUsd.toFixed(5)}/req)\n`;
    markdown += `- **Most Accurate**: ${bestByAccuracy.modelId} (${(bestByAccuracy.accuracy * 100).toFixed(1)}%)\n`;
  }

  // Sample outputs
  markdown += `\n## Sample Outputs\n\n`;

  // Show one successful result per prompt
  for (const promptId of promptIds) {
    const sampleResult = results.find(
      r => r.promptId === promptId && !r.error && r.accuracy === 1
    );
    if (!sampleResult) continue;

    markdown += `### ${promptId}\n`;
    markdown += `**Model**: ${sampleResult.modelId}\n`;
    markdown += `**Latency**: ${sampleResult.latencyMs}ms | **Cost**: $${sampleResult.costUsd.toFixed(5)} | **Tokens**: ${sampleResult.tokensIn}→${sampleResult.tokensOut}\n\n`;
  }

  // Top performers summary
  markdown += `\n## 🏆 Top Performers\n\n`;

  const topSpeed = sorted.slice(0, 3);
  const topCost = [...aggregated]
    .sort((a, b) => a.avgCostUsd - b.avgCostUsd)
    .slice(0, 3);
  const topAccuracy = [...aggregated]
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 3);

  markdown += `**Fastest**:\n`;
  for (const r of topSpeed) {
    markdown += `- ${r.modelId}: ${r.avgLatencyMs.toFixed(1)}ms\n`;
  }

  markdown += `\n**Cheapest**:\n`;
  for (const r of topCost) {
    markdown += `- ${r.modelId}: $${r.avgCostUsd.toFixed(5)}/req\n`;
  }

  markdown += `\n**Most Accurate**:\n`;
  for (const r of topAccuracy) {
    markdown += `- ${r.modelId}: ${(r.accuracy * 100).toFixed(1)}%\n`;
  }

  // Metadata
  markdown += `\n---\n\n**Generated by SentinAI Model Benchmark** | ${new Date().toISOString()}\n`;

  // Ensure directory exists
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch {
    // Directory already exists
  }

  await fs.writeFile(filepath, markdown, 'utf-8');
  return filepath;
}
