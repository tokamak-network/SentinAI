/**
 * Benchmark Script Types
 * Type definitions for model comparison benchmarking
 */

import type { AIProvider, ModelTier } from '@/lib/ai-client';

/**
 * Benchmark test result for a single invocation
 */
export interface BenchmarkResult {
  promptId: string;
  modelId: string;
  provider: AIProvider;
  tier: ModelTier;
  iteration: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  accuracy: 0 | 1; // 1 = passed validation, 0 = failed
  error?: string;
}

/**
 * Aggregated results for a single prompt/model combination
 */
export interface AggregatedResult {
  promptId: string;
  modelId: string;
  provider: AIProvider;
  tier: ModelTier;
  totalIterations: number;
  successfulIterations: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgCostUsd: number;
  totalCostUsd: number;
  accuracy: number; // 0-1
}

/**
 * Prompt definition for benchmarking
 */
export interface PromptDefinition {
  id: string;
  tier: ModelTier;
  description: string;
  systemPrompt: string;
  userPrompt: string;
  expectedOutputType: 'json' | 'markdown' | 'text';
  validationFn: (content: string) => boolean;
}

/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  providers: AIProvider[];
  tiers: ModelTier[];
  iterations: number;
  timeoutFast: number;
  timeoutBest: number;
  outputDir: string;
}
