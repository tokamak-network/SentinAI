#!/usr/bin/env tsx
/**
 * Goal policy training helper
 * Generates confidence-threshold suggestions from stored learning episodes.
 */

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { suggestAutonomyPolicyFromEpisodes } from '../src/lib/goal-learning';

async function main(): Promise<void> {
  const outputDir = path.resolve(process.cwd(), 'docs/verification');
  await mkdir(outputDir, { recursive: true });

  const suggestion = await suggestAutonomyPolicyFromEpisodes(2000);
  const jsonPath = path.join(outputDir, 'goal-learning-policy-suggestion-latest.json');
  const mdPath = path.join(outputDir, 'goal-learning-policy-suggestion-latest.md');

  const markdown = [
    '# Goal Learning Policy Suggestion',
    '',
    `- Generated At: ${suggestion.generatedAt}`,
    `- Sample Size: ${suggestion.sampleSize}`,
    `- Confidence: ${suggestion.confidence}`,
    '',
    '## Current',
    '',
    `- minConfidenceWrite: ${suggestion.current.minConfidenceWrite}`,
    `- minConfidenceDryRun: ${suggestion.current.minConfidenceDryRun}`,
    '',
    '## Suggested',
    '',
    `- minConfidenceWrite: ${suggestion.suggested.minConfidenceWrite}`,
    `- minConfidenceDryRun: ${suggestion.suggested.minConfidenceDryRun}`,
    '',
    '## Notes',
    '',
    ...suggestion.notes.map((note) => `- ${note}`),
    '',
  ].join('\n');

  await Promise.all([
    writeFile(jsonPath, JSON.stringify(suggestion, null, 2), 'utf-8'),
    writeFile(mdPath, markdown, 'utf-8'),
  ]);

  console.info(`[goal-learning] sample=${suggestion.sampleSize} confidence=${suggestion.confidence}`);
  console.info(`[goal-learning] json=${jsonPath}`);
  console.info(`[goal-learning] md=${mdPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`[goal-learning] fatal: ${message}`);
  process.exitCode = 1;
});
