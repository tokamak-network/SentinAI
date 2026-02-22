/**
 * AI Routing Runtime State
 */

import type {
  ModelScoreCard,
  RoutingDecision,
  RoutingBudgetStatus,
  RoutingCircuitState,
  RoutingPolicy,
  RoutingPolicyName,
  RoutingTaskClass,
  RoutingAIProvider,
  RoutingModelTier,
} from '@/types/ai-routing';

const DEFAULT_POLICY_NAME: RoutingPolicyName = 'balanced';
const CIRCUIT_BREAK_THRESHOLD = 3;
const CIRCUIT_BREAK_WINDOW_MS = 2 * 60 * 1000;
const CIRCUIT_OPEN_MS = 5 * 60 * 1000;

const providerEstimatedCostUsd: Record<RoutingAIProvider, Record<RoutingModelTier, number>> = {
  qwen: { fast: 0.003, best: 0.006 },
  anthropic: { fast: 0.012, best: 0.024 },
  openai: { fast: 0.02, best: 0.04 },
  gemini: { fast: 0.008, best: 0.016 },
};

const providerOrderByPolicy: Record<RoutingPolicyName, RoutingAIProvider[]> = {
  'latency-first': ['qwen', 'openai', 'anthropic', 'gemini'],
  balanced: ['qwen', 'anthropic', 'openai', 'gemini'],
  'quality-first': ['openai', 'anthropic', 'qwen', 'gemini'],
  'cost-first': ['qwen', 'gemini', 'anthropic', 'openai'],
};

const scoreCardMap = new Map<RoutingAIProvider, ModelScoreCard>([
  ['qwen', { provider: 'qwen', totalRequests: 0, successCount: 0, failureCount: 0, avgLatencyMs: 0 }],
  ['anthropic', { provider: 'anthropic', totalRequests: 0, successCount: 0, failureCount: 0, avgLatencyMs: 0 }],
  ['openai', { provider: 'openai', totalRequests: 0, successCount: 0, failureCount: 0, avgLatencyMs: 0 }],
  ['gemini', { provider: 'gemini', totalRequests: 0, successCount: 0, failureCount: 0, avgLatencyMs: 0 }],
]);

type ProviderCircuitRuntime = {
  failureCount: number;
  lastFailureAt: number | null;
  openUntil: number | null;
};

const providerCircuitMap = new Map<RoutingAIProvider, ProviderCircuitRuntime>([
  ['qwen', { failureCount: 0, lastFailureAt: null, openUntil: null }],
  ['anthropic', { failureCount: 0, lastFailureAt: null, openUntil: null }],
  ['openai', { failureCount: 0, lastFailureAt: null, openUntil: null }],
  ['gemini', { failureCount: 0, lastFailureAt: null, openUntil: null }],
]);

const routingHistory: RoutingDecision[] = [];
const ROUTING_HISTORY_MAX = 500;

let runtimePolicyOverride: RoutingPolicy | null = null;
let budgetWindowDate = '';
let budgetSpentUsd = 0;

function getDateKey(timestamp: Date = new Date()): string {
  return timestamp.toISOString().slice(0, 10);
}

function roundToMicrousd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function ensureBudgetWindow(): void {
  const today = getDateKey();
  if (budgetWindowDate !== today) {
    budgetWindowDate = today;
    budgetSpentUsd = 0;
  }
}

function getProviderCircuitRuntime(provider: RoutingAIProvider): ProviderCircuitRuntime {
  const runtime = providerCircuitMap.get(provider);
  if (!runtime) {
    const fallback: ProviderCircuitRuntime = { failureCount: 0, lastFailureAt: null, openUntil: null };
    providerCircuitMap.set(provider, fallback);
    return fallback;
  }

  if (runtime.openUntil !== null && runtime.openUntil <= Date.now()) {
    runtime.openUntil = null;
    runtime.failureCount = 0;
  }
  return runtime;
}

function markProviderFailure(provider: RoutingAIProvider): void {
  const runtime = getProviderCircuitRuntime(provider);
  const now = Date.now();
  const inWindow = runtime.lastFailureAt !== null && now - runtime.lastFailureAt <= CIRCUIT_BREAK_WINDOW_MS;
  runtime.failureCount = inWindow ? runtime.failureCount + 1 : 1;
  runtime.lastFailureAt = now;

  if (runtime.failureCount >= CIRCUIT_BREAK_THRESHOLD) {
    runtime.openUntil = now + CIRCUIT_OPEN_MS;
  }
}

function markProviderSuccess(provider: RoutingAIProvider): void {
  const runtime = getProviderCircuitRuntime(provider);
  runtime.failureCount = 0;
  runtime.lastFailureAt = null;
  runtime.openUntil = null;
}

function isProviderBlocked(provider: RoutingAIProvider): boolean {
  const runtime = getProviderCircuitRuntime(provider);
  return runtime.openUntil !== null && runtime.openUntil > Date.now();
}

function parsePolicyName(raw?: string): RoutingPolicyName {
  if (
    raw === 'latency-first' ||
    raw === 'balanced' ||
    raw === 'quality-first' ||
    raw === 'cost-first'
  ) {
    return raw;
  }
  return DEFAULT_POLICY_NAME;
}

function parseIntWithDefault(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function getRoutingPolicy(): RoutingPolicy {
  if (runtimePolicyOverride) return runtimePolicyOverride;

  return {
    name: parsePolicyName(process.env.AI_ROUTING_POLICY),
    abPercent: Math.min(Math.max(parseIntWithDefault(process.env.AI_ROUTING_AB_PERCENT, 10), 0), 100),
    budgetUsdDaily: Math.max(parseIntWithDefault(process.env.AI_ROUTING_BUDGET_USD_DAILY, 50), 1),
    enabled: process.env.AI_ROUTING_ENABLED === 'true',
  };
}

export function setRoutingPolicy(update: Partial<RoutingPolicy>): RoutingPolicy {
  const current = getRoutingPolicy();
  const next: RoutingPolicy = {
    name: update.name ? parsePolicyName(update.name) : current.name,
    abPercent:
      update.abPercent !== undefined
        ? Math.min(Math.max(Math.round(update.abPercent), 0), 100)
        : current.abPercent,
    budgetUsdDaily:
      update.budgetUsdDaily !== undefined
        ? Math.max(Math.round(update.budgetUsdDaily), 1)
        : current.budgetUsdDaily,
    enabled: update.enabled !== undefined ? update.enabled : current.enabled,
  };

  runtimePolicyOverride = next;
  return next;
}

export function getProviderPriority(policyName: RoutingPolicyName): RoutingAIProvider[] {
  return [...providerOrderByPolicy[policyName]];
}

export function resolveTaskClass(modelTier: RoutingModelTier): RoutingTaskClass {
  return modelTier === 'fast' ? 'realtime-critical' : 'analysis-standard';
}

export function shouldApplyRoutingSample(seed: string, abPercent: number): boolean {
  if (abPercent >= 100) return true;
  if (abPercent <= 0) return false;

  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 100 < abPercent;
}

export function estimateRequestCost(
  provider: RoutingAIProvider,
  modelTier: RoutingModelTier
): number {
  return providerEstimatedCostUsd[provider][modelTier];
}

export function getRoutingBudgetStatus(policy: RoutingPolicy = getRoutingPolicy()): RoutingBudgetStatus {
  ensureBudgetWindow();
  return {
    date: budgetWindowDate || getDateKey(),
    spentUsd: roundToMicrousd(budgetSpentUsd),
    budgetUsdDaily: policy.budgetUsdDaily,
    exceeded: budgetSpentUsd >= policy.budgetUsdDaily,
  };
}

function isBudgetConstrained(
  taskClass: RoutingTaskClass,
  policy: RoutingPolicy
): boolean {
  const budget = getRoutingBudgetStatus(policy);
  if (!budget.exceeded) return false;
  return taskClass !== 'realtime-critical' && taskClass !== 'deep-critical';
}

export function selectProvidersForTask(
  taskClass: RoutingTaskClass,
  policy: RoutingPolicy = getRoutingPolicy()
): {
  providers: RoutingAIProvider[];
  blockedProviders: RoutingAIProvider[];
  budgetConstrained: boolean;
  appliedPolicy: RoutingPolicyName;
} {
  const budgetConstrained = isBudgetConstrained(taskClass, policy);
  const appliedPolicy: RoutingPolicyName = budgetConstrained ? 'cost-first' : policy.name;
  const preferred = getProviderPriority(appliedPolicy);
  const blockedProviders = preferred.filter((provider) => isProviderBlocked(provider));
  const available = preferred.filter((provider) => !isProviderBlocked(provider));

  // Fail-open behavior: if all providers are blocked, keep original order.
  return {
    providers: available.length > 0 ? available : preferred,
    blockedProviders,
    budgetConstrained,
    appliedPolicy,
  };
}

export function getRoutingCircuitStates(): RoutingCircuitState[] {
  const providers: RoutingAIProvider[] = ['qwen', 'anthropic', 'openai', 'gemini'];
  return providers.map((provider) => {
    const runtime = getProviderCircuitRuntime(provider);
    const isOpen = runtime.openUntil !== null && runtime.openUntil > Date.now();
    return {
      provider,
      failureCount: runtime.failureCount,
      isOpen,
      openUntil: runtime.openUntil ? new Date(runtime.openUntil).toISOString() : undefined,
      lastFailureAt: runtime.lastFailureAt ? new Date(runtime.lastFailureAt).toISOString() : undefined,
    };
  });
}

export function recordRoutingDecision(decision: RoutingDecision): void {
  ensureBudgetWindow();

  if (decision.success) {
    markProviderSuccess(decision.provider);
  } else {
    markProviderFailure(decision.provider);
  }

  const estimatedCostUsd =
    decision.estimatedCostUsd ??
    (decision.success ? estimateRequestCost(decision.provider, decision.modelTier) : undefined);

  if (estimatedCostUsd && estimatedCostUsd > 0 && decision.success) {
    budgetSpentUsd = roundToMicrousd(budgetSpentUsd + estimatedCostUsd);
  }

  const persistedDecision: RoutingDecision = {
    ...decision,
    estimatedCostUsd,
    circuitOpen: isProviderBlocked(decision.provider),
  };

  routingHistory.push(persistedDecision);
  if (routingHistory.length > ROUTING_HISTORY_MAX) {
    routingHistory.splice(0, routingHistory.length - ROUTING_HISTORY_MAX);
  }

  const card = scoreCardMap.get(persistedDecision.provider);
  if (!card) return;

  card.totalRequests += 1;
  if (persistedDecision.success) {
    card.successCount += 1;
  } else {
    card.failureCount += 1;
    card.lastErrorAt = persistedDecision.timestamp;
  }

  if (persistedDecision.latencyMs !== undefined) {
    const prevWeighted = card.avgLatencyMs * (card.totalRequests - 1);
    card.avgLatencyMs = (prevWeighted + persistedDecision.latencyMs) / card.totalRequests;
  }
}

export function getRoutingScoreCards(): ModelScoreCard[] {
  return Array.from(scoreCardMap.values()).map((item) => ({ ...item }));
}

export function getRecentRoutingHistory(limit: number = 50): RoutingDecision[] {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  return routingHistory.slice(-safeLimit).reverse();
}

function getRoutingFallbackCounters() {
  const attemptsByRequest = new Map<string, RoutingDecision[]>();
  let anonymousAttemptCount = 0;

  for (const decision of routingHistory) {
    if (!decision.requestId) {
      anonymousAttemptCount += 1;
      continue;
    }

    const bucket = attemptsByRequest.get(decision.requestId) || [];
    bucket.push(decision);
    attemptsByRequest.set(decision.requestId, bucket);
  }

  let fallbackRecovered = 0;
  let fallbackFailed = 0;
  let failedAttempts = 0;
  let successfulResponses = 0;

  for (const attempts of attemptsByRequest.values()) {
    let hasFailure = false;
    let hasSuccess = false;
    for (const attempt of attempts) {
      if (attempt.success) {
        hasSuccess = true;
        successfulResponses += 1;
      } else {
        hasFailure = true;
        failedAttempts += 1;
      }
    }

    if (hasFailure && hasSuccess) fallbackRecovered += 1;
    if (hasFailure && !hasSuccess) fallbackFailed += 1;
  }

  const totalRequests = attemptsByRequest.size + anonymousAttemptCount;
  const totalAttempts = routingHistory.length;

  return {
    totalRequests,
    totalAttempts,
    successfulResponses,
    failedAttempts,
    fallbackRecovered,
    fallbackFailed,
  };
}

export function getRoutingStatus() {
  const policy = getRoutingPolicy();
  return {
    policy,
    scoreCards: getRoutingScoreCards(),
    recentDecisions: getRecentRoutingHistory(50),
    circuitStates: getRoutingCircuitStates(),
    budget: getRoutingBudgetStatus(policy),
    counters: getRoutingFallbackCounters(),
  };
}

export function resetRoutingRuntimeState(): void {
  routingHistory.splice(0, routingHistory.length);
  budgetWindowDate = '';
  budgetSpentUsd = 0;

  for (const card of scoreCardMap.values()) {
    card.totalRequests = 0;
    card.successCount = 0;
    card.failureCount = 0;
    card.avgLatencyMs = 0;
    card.lastErrorAt = undefined;
  }

  for (const runtime of providerCircuitMap.values()) {
    runtime.failureCount = 0;
    runtime.lastFailureAt = null;
    runtime.openUntil = null;
  }
}
