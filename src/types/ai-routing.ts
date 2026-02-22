/**
 * AI Routing Types
 */

export type RoutingAIProvider = 'qwen' | 'anthropic' | 'openai' | 'gemini';
export type RoutingModelTier = 'fast' | 'best';

export type RoutingPolicyName =
  | 'latency-first'
  | 'balanced'
  | 'quality-first'
  | 'cost-first';

export type RoutingTaskClass =
  | 'realtime-critical'
  | 'analysis-standard'
  | 'deep-critical';

export interface RoutingPolicy {
  name: RoutingPolicyName;
  abPercent: number;
  budgetUsdDaily: number;
  enabled: boolean;
}

export interface RoutingDecision {
  requestId?: string;
  attempt?: number;
  timestamp: string;
  taskClass: RoutingTaskClass;
  provider: RoutingAIProvider;
  model: string;
  modelTier: RoutingModelTier;
  policyName: RoutingPolicyName;
  latencyMs?: number;
  estimatedCostUsd?: number;
  budgetConstrained?: boolean;
  circuitOpen?: boolean;
  success: boolean;
  error?: string;
}

export interface ModelScoreCard {
  provider: RoutingAIProvider;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  lastErrorAt?: string;
}

export interface RoutingCircuitState {
  provider: RoutingAIProvider;
  failureCount: number;
  isOpen: boolean;
  openUntil?: string;
  lastFailureAt?: string;
}

export interface RoutingBudgetStatus {
  date: string;
  spentUsd: number;
  budgetUsdDaily: number;
  exceeded: boolean;
}
