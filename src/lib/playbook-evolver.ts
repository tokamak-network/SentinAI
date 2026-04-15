import type { OperationalPattern, PlaybookVersion } from './playbook-evolution-types';

let versionCounter = 0;

/**
 * In-memory playbook evolver. Generates new playbook versions from mined patterns.
 */
export class PlaybookEvolver {
  async generateFromPatterns(patterns: OperationalPattern[]): Promise<PlaybookVersion> {
    versionCounter += 1;
    const versionId = `v-${versionCounter}`;

    const baseConfidence = 0.1;
    const patternBonus = patterns.reduce((sum, p) => sum + p.confidence * 0.1, 0);
    const confidence = Math.min(1, baseConfidence + patternBonus);

    const conditions = patterns.map((p) => ({
      anomalyType: p.anomalyType,
      action: p.effectiveAction,
      minSuccessRate: p.successRate,
    }));

    const playbook: Record<string, unknown> = {
      id: versionId,
      conditions,
    };

    return {
      versionId,
      generatedBy: 'claude-sonnet-4-5-20250929',
      generatedAt: new Date().toISOString(),
      source: 'ai-assisted',
      confidence,
      successRate: patterns.length > 0
        ? patterns.reduce((sum, p) => sum + p.successRate, 0) / patterns.length
        : 0,
      totalApplications: 0,
      playbook,
    };
  }
}
