import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildGoalPlan,
  executeGoalPlan,
  getGoalPlanById,
  getGoalPlanHistory,
  saveGoalPlan,
} from '@/lib/goal-planner';

const hoisted = vi.hoisted(() => ({
  metricsMock: {
    getRecentMetrics: vi.fn(),
  },
  anomaliesMock: {
    getEvents: vi.fn(),
  },
  rcaMock: {
    performRCA: vi.fn(),
    addRCAHistory: vi.fn(),
  },
  scalerMock: {
    getScalingState: vi.fn(),
    scaleOpGeth: vi.fn(),
  },
  actionMock: {
    executeAction: vi.fn(),
  },
  routingMock: {
    setRoutingPolicy: vi.fn(),
  },
}));

vi.mock('@/chains', () => ({
  getChainPlugin: vi.fn(() => ({
    primaryExecutionClient: 'op-geth',
  })),
}));

vi.mock('@/lib/metrics-store', () => ({
  getRecentMetrics: hoisted.metricsMock.getRecentMetrics,
}));

vi.mock('@/lib/anomaly-event-store', () => ({
  getEvents: hoisted.anomaliesMock.getEvents,
}));

vi.mock('@/lib/anomaly-detector', () => ({
  detectAnomalies: vi.fn(() => []),
}));

vi.mock('@/lib/log-ingester', () => ({
  getAllLiveLogs: vi.fn(async () => ({ 'op-geth': 'INFO test' })),
  generateMockLogs: vi.fn(() => ({ 'op-geth': 'INFO mock' })),
}));

vi.mock('@/lib/rca-engine', () => ({
  performRCA: hoisted.rcaMock.performRCA,
  addRCAHistory: hoisted.rcaMock.addRCAHistory,
}));

vi.mock('@/lib/action-executor', () => ({
  executeAction: hoisted.actionMock.executeAction,
}));

vi.mock('@/lib/ai-routing', () => ({
  setRoutingPolicy: hoisted.routingMock.setRoutingPolicy,
}));

vi.mock('@/lib/k8s-scaler', () => ({
  getScalingState: hoisted.scalerMock.getScalingState,
  scaleOpGeth: hoisted.scalerMock.scaleOpGeth,
}));

describe('goal-planner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOAL_PLANNER_LLM_ENABLED = 'false';
    hoisted.metricsMock.getRecentMetrics.mockResolvedValue([
      {
        timestamp: new Date().toISOString(),
        cpuUsage: 72,
        blockHeight: 100,
        blockInterval: 2.0,
        txPoolPending: 10,
        gasUsedRatio: 0.5,
        currentVcpu: 2,
      },
    ]);
    hoisted.anomaliesMock.getEvents.mockResolvedValue({
      events: [],
      total: 0,
      activeCount: 0,
    });
    hoisted.scalerMock.getScalingState.mockResolvedValue({
      currentVcpu: 2,
      currentMemoryGiB: 4,
      lastScalingTime: null,
      lastDecision: null,
      cooldownRemaining: 0,
      autoScalingEnabled: true,
    });
    hoisted.scalerMock.scaleOpGeth.mockResolvedValue({
      success: true,
      previousVcpu: 2,
      currentVcpu: 4,
      previousMemoryGiB: 4,
      currentMemoryGiB: 8,
      timestamp: new Date().toISOString(),
      message: 'scaled',
    });
    hoisted.actionMock.executeAction.mockResolvedValue({
      status: 'success',
      output: 'restarted',
    });
    hoisted.rcaMock.performRCA.mockResolvedValue({
      id: 'rca-1',
      rootCause: {
        component: 'op-geth',
        description: 'No critical issue',
        confidence: 0.9,
      },
      causalChain: [],
      affectedComponents: ['op-geth'],
      timeline: [],
      remediation: {
        immediate: ['Monitor node status'],
        preventive: ['Keep anomaly alerts enabled'],
      },
      generatedAt: new Date().toISOString(),
    });
  });

  it('builds stabilize plan from natural language goal', async () => {
    const plan = await buildGoalPlan('L2 안정화가 필요하다', true);
    expect(plan.intent).toBe('stabilize');
    expect(plan.planVersion).toBe('v1-rule');
    expect(plan.steps.some((step) => step.action === 'scale_execution')).toBe(true);
    expect(plan.status).toBe('planned');
  });

  it('skips approval-required write steps when allowWrites is false', async () => {
    const plan = await buildGoalPlan('비용 최적화', true);
    const result = await executeGoalPlan(plan, {
      dryRun: true,
      allowWrites: false,
      initiatedBy: 'api',
    });

    const writeStep = result.plan.steps.find((step) => step.action === 'scale_execution');
    expect(writeStep?.status).toBe('skipped');
    expect(hoisted.scalerMock.scaleOpGeth).not.toHaveBeenCalled();
  });

  it('executes recovery restart when writes are allowed', async () => {
    const plan = await buildGoalPlan('노드 복구를 위해 restart 해줘', false);
    const result = await executeGoalPlan(plan, {
      dryRun: false,
      allowWrites: true,
      initiatedBy: 'mcp',
    });

    expect(result.plan.status).toBe('completed');
    expect(hoisted.actionMock.executeAction).toHaveBeenCalled();
  });

  it('stores and retrieves plan history', async () => {
    const plan = await buildGoalPlan('RCA 분석', true);
    const saved = saveGoalPlan(plan);
    const history = getGoalPlanHistory(5);
    const loaded = getGoalPlanById(saved.planId);

    expect(history.length).toBeGreaterThan(0);
    expect(loaded?.planId).toBe(saved.planId);
  });
});
