import type { ScenarioResult, ProviderRecommendation } from '../types';

/**
 * Formats test results into human-readable reports
 * Supports: Markdown tables, JSON export, provider recommendations
 */
export class ResultFormatter {
  /**
   * Format results as Markdown table
   */
  formatMarkdownTable(results: ScenarioResult[]): string {
    const header = '| Provider | Tier | Avg Lat(ms) | P95(ms) | Cost/req | Accuracy | Errors |';
    const separator = '|----------|------|-------------|--------|----------|----------|--------|';

    const rows = results.map(r =>
      `| ${r.provider} | ${r.tier} | ${r.avgLatencyMs.toFixed(0)} | ${r.p95LatencyMs.toFixed(0)} | $${r.avgCostPerRequest.toFixed(4)} | ${r.accuracy.toFixed(1)}% | ${r.failedRequests} |`
    );

    return [header, separator, ...rows].join('\n');
  }

  /**
   * Format comprehensive report with sections and recommendations
   */
  formatComprehensiveReport(results: ScenarioResult[]): string {
    const groupedByScenario = this.groupByScenario(results);
    const timestamp = new Date().toISOString();
    const totalRequests = results.reduce((s, r) => s + r.totalRequests, 0);
    const totalCost = results.reduce((s, r) => s + r.totalCostUsd, 0);
    const totalDuration = Math.max(...results.map(r => r.duration));

    let report = '# LLM Stress Test Report\n\n';
    report += `**Generated**: ${timestamp}\n\n`;

    // Executive Summary
    report += '## Executive Summary\n\n';
    report += `- **Total Tests**: ${results.length}\n`;
    report += `- **Total Requests**: ${totalRequests.toLocaleString()}\n`;
    report += `- **Total Cost**: $${totalCost.toFixed(2)}\n`;
    report += `- **Duration**: ${(totalDuration / 1000).toFixed(1)}s\n`;
    report += `- **Avg Cost/Request**: $${(totalCost / totalRequests).toFixed(6)}\n\n`;

    // Scenario Results
    for (const [scenario, scenarioResults] of Object.entries(groupedByScenario)) {
      report += `## ${scenario}\n\n`;
      report += this.formatMarkdownTable(scenarioResults);
      report += '\n\n';

      // Scenario-specific recommendations
      const recommendations = this.findBestProviders(scenarioResults);
      if (recommendations.length > 0) {
        report += '### Recommendations\n\n';
        for (const rec of recommendations) {
          report += `**${rec.provider.toUpperCase()} ${rec.tier.toUpperCase()}**: `;
          report += `${rec.reason} `;
          report += `(Latency: ${rec.latency.toFixed(0)}ms, Cost: $${rec.cost.toFixed(4)}, Accuracy: ${rec.accuracy.toFixed(1)}%)\n`;
        }
        report += '\n';
      }
    }

    // Cost Analysis
    report += '## Cost Analysis\n\n';
    const costByProvider = this.analyzeCostByProvider(results);
    for (const [provider, cost] of Object.entries(costByProvider)) {
      const ratio = (cost as number) / totalCost;
      report += `- **${provider}**: $${(cost as number).toFixed(2)} (${(ratio * 100).toFixed(1)}%)\n`;
    }
    report += '\n';

    // Performance Summary
    report += '## Performance Summary\n\n';
    const avgLatencies = this.calculateAverageMetrics(results);
    report += `- **Average Latency**: ${avgLatencies.latency.toFixed(0)}ms\n`;
    report += `- **Average P95 Latency**: ${avgLatencies.p95Latency.toFixed(0)}ms\n`;
    report += `- **Average Accuracy**: ${avgLatencies.accuracy.toFixed(1)}%\n`;
    report += `- **Total Error Rate**: ${(this.calculateErrorRate(results) * 100).toFixed(2)}%\n\n`;

    // Key Findings
    report += '## Key Findings\n\n';
    const findings = this.generateKeyFindings(results);
    for (const finding of findings) {
      report += `- ${finding}\n`;
    }
    report += '\n';

    // Detailed Results
    report += '## Detailed Results\n\n';
    for (const result of results) {
      report += `### ${result.provider} - ${result.tier} (${result.scenario} / ${result.testLoad})\n`;
      report += `- Requests: ${result.totalRequests} (Success: ${result.successfulRequests}, Failed: ${result.failedRequests})\n`;
      report += `- Latency: ${result.avgLatencyMs.toFixed(0)}ms avg, ${result.p95LatencyMs.toFixed(0)}ms P95, ${result.p99LatencyMs.toFixed(0)}ms P99\n`;
      report += `- Cost: $${result.totalCostUsd.toFixed(2)} total, $${result.avgCostPerRequest.toFixed(4)}/request\n`;
      report += `- Accuracy: ${result.accuracy.toFixed(1)}%\n`;
      report += `- Duration: ${(result.duration / 1000).toFixed(1)}s\n\n`;
    }

    return report;
  }

  /**
   * Export results as JSON
   */
  formatJSON(results: ScenarioResult[]): string {
    return JSON.stringify(results, null, 2);
  }

  /**
   * Group results by scenario
   */
  private groupByScenario(results: ScenarioResult[]) {
    return results.reduce(
      (acc, r) => {
        if (!acc[r.scenario]) acc[r.scenario] = [];
        acc[r.scenario].push(r);
        return acc;
      },
      {} as Record<string, ScenarioResult[]>
    );
  }

  /**
   * Find best providers for a scenario
   * Top 3 by composite score (latency + cost + accuracy)
   */
  private findBestProviders(results: ScenarioResult[]): ProviderRecommendation[] {
    if (results.length === 0) return [];

    // Filter qualified providers (accuracy > 80%, reasonable latency)
    const qualified = results.filter(r => r.accuracy >= 80);

    if (qualified.length === 0) {
      return results
        .sort((a, b) => b.accuracy - a.accuracy)
        .slice(0, 1)
        .map(r => ({
          provider: r.provider,
          tier: r.tier,
          reason: `Highest accuracy (${r.accuracy.toFixed(1)}%) - consider improving setup`,
          latency: r.avgLatencyMs,
          cost: r.avgCostPerRequest,
          accuracy: r.accuracy,
          score: r.accuracy,
        }));
    }

    // Calculate composite score: balance latency, cost, accuracy
    const scored = qualified.map(r => {
      const maxLatency = Math.max(...qualified.map(q => q.avgLatencyMs));
      const maxCost = Math.max(...qualified.map(q => q.avgCostPerRequest));
      const latencyScore = 1 - r.avgLatencyMs / maxLatency;
      const costScore = 1 - r.avgCostPerRequest / maxCost;
      const accuracyScore = r.accuracy / 100;

      // Weighted scoring: 40% latency, 30% cost, 30% accuracy
      const compositeScore = latencyScore * 0.4 + costScore * 0.3 + accuracyScore * 0.3;

      return {
        provider: r.provider,
        tier: r.tier,
        reason: `Composite score: ${compositeScore.toFixed(2)}`,
        latency: r.avgLatencyMs,
        cost: r.avgCostPerRequest,
        accuracy: r.accuracy,
        score: compositeScore,
      };
    });

    // Return top 3
    return scored.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  /**
   * Analyze total cost by provider
   */
  private analyzeCostByProvider(results: ScenarioResult[]): Record<string, number> {
    return results.reduce(
      (acc, r) => {
        acc[r.provider] = (acc[r.provider] || 0) + r.totalCostUsd;
        return acc;
      },
      {} as Record<string, number>
    );
  }

  /**
   * Calculate average metrics across all results
   */
  private calculateAverageMetrics(results: ScenarioResult[]) {
    if (results.length === 0) {
      return { latency: 0, p95Latency: 0, accuracy: 0 };
    }

    const avgLatency = results.reduce((s, r) => s + r.avgLatencyMs, 0) / results.length;
    const avgP95 = results.reduce((s, r) => s + r.p95LatencyMs, 0) / results.length;
    const avgAccuracy = results.reduce((s, r) => s + r.accuracy, 0) / results.length;

    return {
      latency: avgLatency,
      p95Latency: avgP95,
      accuracy: avgAccuracy,
    };
  }

  /**
   * Calculate overall error rate
   */
  private calculateErrorRate(results: ScenarioResult[]): number {
    const totalRequests = results.reduce((s, r) => s + r.totalRequests, 0);
    const totalFailed = results.reduce((s, r) => s + r.failedRequests, 0);
    return totalFailed / totalRequests;
  }

  /**
   * Generate key findings from results
   */
  private generateKeyFindings(results: ScenarioResult[]): string[] {
    const findings: string[] = [];

    // Fastest provider
    const fastest = results.reduce((min, r) => r.avgLatencyMs < min.avgLatencyMs ? r : min);
    findings.push(`Fastest: ${fastest.provider} (${fastest.avgLatencyMs.toFixed(0)}ms avg)`);

    // Cheapest provider
    const cheapest = results.reduce((min, r) => r.avgCostPerRequest < min.avgCostPerRequest ? r : min);
    findings.push(`Cheapest: ${cheapest.provider} ($${cheapest.avgCostPerRequest.toFixed(6)}/request)`);

    // Most accurate
    const mostAccurate = results.reduce((max, r) => r.accuracy > max.accuracy ? r : max);
    findings.push(`Most accurate: ${mostAccurate.provider} (${mostAccurate.accuracy.toFixed(1)}%)`);

    // Error analysis
    const errorRate = this.calculateErrorRate(results);
    if (errorRate > 0.01) {
      findings.push(`⚠️ High error rate: ${(errorRate * 100).toFixed(2)}% - investigate provider stability`);
    }

    // Cost efficiency
    const totalCost = results.reduce((s, r) => s + r.totalCostUsd, 0);
    const totalAccuracy = results.reduce((s, r) => s + r.accuracy * r.totalRequests, 0) / results.reduce((s, r) => s + r.totalRequests, 0);
    findings.push(`Cost efficiency: $${(totalCost / totalAccuracy).toFixed(6)}/accuracy-percent`);

    return findings;
  }
}
