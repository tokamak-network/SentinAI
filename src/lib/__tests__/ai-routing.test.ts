import { beforeEach, describe, expect, it } from 'vitest';
import {
  getRoutingBudgetStatus,
  getRoutingCircuitStates,
  getProviderPriority,
  getRoutingPolicy,
  getRoutingStatus,
  recordRoutingDecision,
  resetRoutingRuntimeState,
  selectProvidersForTask,
  setRoutingPolicy,
  shouldApplyRoutingSample,
} from '@/lib/ai-routing';

describe('ai-routing', () => {
  beforeEach(() => {
    delete process.env.AI_ROUTING_ENABLED;
    delete process.env.AI_ROUTING_POLICY;
    delete process.env.AI_ROUTING_AB_PERCENT;
    delete process.env.AI_ROUTING_BUDGET_USD_DAILY;
    resetRoutingRuntimeState();
    setRoutingPolicy({
      enabled: false,
      name: 'balanced',
      abPercent: 10,
      budgetUsdDaily: 50,
    });
  });

  it('should load default policy from env fallback', () => {
    const policy = getRoutingPolicy();
    expect(policy.name).toBe('balanced');
    expect(policy.enabled).toBe(false);
  });

  it('should update policy at runtime', () => {
    const updated = setRoutingPolicy({
      name: 'cost-first',
      enabled: true,
      abPercent: 25,
      budgetUsdDaily: 80,
    });

    expect(updated.name).toBe('cost-first');
    expect(updated.enabled).toBe(true);
    expect(updated.abPercent).toBe(25);
    expect(updated.budgetUsdDaily).toBe(80);
  });

  it('should provide provider order by policy', () => {
    const priority = getProviderPriority('quality-first');
    expect(priority[0]).toBe('openai');
    expect(priority).toContain('qwen');
  });

  it('should deterministically sample by seed and percent', () => {
    const a = shouldApplyRoutingSample('seed-1', 30);
    const b = shouldApplyRoutingSample('seed-1', 30);
    expect(a).toBe(b);
  });

  it('should record routing decision into scorecard', () => {
    recordRoutingDecision({
      timestamp: new Date().toISOString(),
      taskClass: 'realtime-critical',
      provider: 'qwen',
      model: 'qwen3-80b-next',
      modelTier: 'fast',
      policyName: 'balanced',
      success: true,
      latencyMs: 1200,
    });

    const status = getRoutingStatus();
    const qwenCard = status.scoreCards.find((card) => card.provider === 'qwen');
    expect(qwenCard).toBeDefined();
    expect(qwenCard?.totalRequests).toBeGreaterThan(0);
    expect(qwenCard?.successCount).toBeGreaterThan(0);
  });

  it('should open provider circuit after repeated failures', () => {
    for (let i = 0; i < 3; i++) {
      recordRoutingDecision({
        timestamp: new Date().toISOString(),
        taskClass: 'realtime-critical',
        provider: 'openai',
        model: 'gpt-5.2',
        modelTier: 'fast',
        policyName: 'balanced',
        success: false,
        error: '429 too many requests',
      });
    }

    const states = getRoutingCircuitStates();
    const openai = states.find((item) => item.provider === 'openai');
    expect(openai?.isOpen).toBe(true);
  });

  it('should switch to cost-first order when budget is exceeded for non-critical tasks', () => {
    setRoutingPolicy({
      enabled: true,
      name: 'quality-first',
      abPercent: 100,
      budgetUsdDaily: 1,
    });

    for (let i = 0; i < 30; i++) {
      recordRoutingDecision({
        timestamp: new Date().toISOString(),
        taskClass: 'analysis-standard',
        provider: 'openai',
        model: 'gpt-5.2-codex',
        modelTier: 'best',
        policyName: 'quality-first',
        success: true,
      });
    }

    const budget = getRoutingBudgetStatus();
    expect(budget.exceeded).toBe(true);

    const selection = selectProvidersForTask('analysis-standard');
    expect(selection.budgetConstrained).toBe(true);
    expect(selection.appliedPolicy).toBe('cost-first');
    expect(selection.providers[0]).toBe('qwen');
  });

  it('should expose fallback counters in routing status', () => {
    recordRoutingDecision({
      requestId: 'req-1',
      attempt: 1,
      timestamp: new Date().toISOString(),
      taskClass: 'analysis-standard',
      provider: 'openai',
      model: 'gpt-5.2-codex',
      modelTier: 'best',
      policyName: 'balanced',
      success: false,
      error: 'timeout',
    });
    recordRoutingDecision({
      requestId: 'req-1',
      attempt: 2,
      timestamp: new Date().toISOString(),
      taskClass: 'analysis-standard',
      provider: 'qwen',
      model: 'qwen3-80b-next',
      modelTier: 'best',
      policyName: 'balanced',
      success: true,
    });

    const status = getRoutingStatus();
    expect(status.counters.totalRequests).toBe(1);
    expect(status.counters.totalAttempts).toBe(2);
    expect(status.counters.fallbackRecovered).toBe(1);
    expect(status.counters.failedAttempts).toBe(1);
    expect(status.counters.successfulResponses).toBe(1);
  });
});
