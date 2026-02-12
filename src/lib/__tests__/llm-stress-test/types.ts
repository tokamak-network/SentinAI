import type { AIProvider, ModelTier } from '@/lib/ai-client';

/**
 * Test Configuration
 */
export interface TestConfig {
  providers: AIProvider[];
  tiers: ModelTier[];
  scenarios: ScenarioName[];
  outputDir: string;
}

/**
 * Test Load Profile
 */
export interface TestLoad {
  name: string;
  requests: number;
  parallelism: number;
}

/**
 * Single LLM Invocation Result
 */
export interface InvokeResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costUsd: number;
  provider: AIProvider;
  model: string;
  timestamp: number;
  error?: string;
}

/**
 * Scenario-level Aggregated Results
 */
export interface ScenarioResult {
  scenario: string;
  provider: AIProvider;
  tier: ModelTier;
  testLoad: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;

  // Latency metrics (milliseconds)
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;

  // Cost metrics
  avgCostPerRequest: number;
  totalCostUsd: number;

  // Accuracy metric
  accuracy: number; // Percentage (0-100)

  // Metadata
  duration: number; // milliseconds
  timestamp: string; // ISO 8601
}

/**
 * Aggregated Cross-Scenario Metrics
 */
export interface AggregatedMetrics {
  latency: LatencyStats;
  cost: CostStats;
  accuracy: AccuracyStats;
  timestamp: string;
}

/**
 * Latency Statistics
 */
export interface LatencyStats {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Cost Statistics
 */
export interface CostStats {
  totalCost: number;
  avgCostPerRequest: number;
  minCostPerRequest: number;
  maxCostPerRequest: number;
  costsumByProvider: Record<AIProvider, number>;
}

/**
 * Accuracy Statistics
 */
export interface AccuracyStats {
  mean: number;
  min: number;
  max: number;
  byProvider: Record<AIProvider, number>;
  byTier: Record<ModelTier, number>;
}

/**
 * Provider Recommendation
 */
export interface ProviderRecommendation {
  provider: AIProvider;
  tier: ModelTier;
  reason: string;
  latency: number;
  cost: number;
  accuracy: number;
  score: number; // Composite score for ranking
}

/**
 * Scenario Names
 */
export type ScenarioName = 'fast-tier' | 'best-tier' | 'mixed-workload';

/**
 * Test Data Pair
 */
export interface TestDataPair {
  input: string;
  expected: unknown;
}

/**
 * Formatted Report Output
 */
export interface FormattedReport {
  markdown: string;
  json: string;
  recommendations: ProviderRecommendation[];
}
