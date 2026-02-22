import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMcpRequest } from '@/lib/mcp-server';
import type { McpApprovalTicket } from '@/types/mcp';

const hoisted = vi.hoisted(() => ({
  metricsStoreMock: {
    getRecentMetrics: vi.fn(),
    getMetricsCount: vi.fn(),
  },
  anomalyStoreMock: {
    getEvents: vi.fn(),
  },
  rcaMock: {
    performRCA: vi.fn(),
    addRCAHistory: vi.fn(),
  },
  scalerMock: {
    getScalingState: vi.fn(),
    scaleOpGeth: vi.fn(),
    addScalingHistory: vi.fn(),
  },
  actionExecutorMock: {
    executeAction: vi.fn(),
  },
  goalPlannerMock: {
    buildGoalPlan: vi.fn(),
    executeGoalPlan: vi.fn(),
    saveGoalPlan: vi.fn(),
  },
  approvalTicketMap: new Map<string, McpApprovalTicket>(),
}));

vi.mock('@/chains', () => ({
  getChainPlugin: vi.fn(() => ({
    primaryExecutionClient: 'op-geth',
  })),
}));

vi.mock('@/lib/metrics-store', () => ({
  getRecentMetrics: hoisted.metricsStoreMock.getRecentMetrics,
  getMetricsCount: hoisted.metricsStoreMock.getMetricsCount,
}));

vi.mock('@/lib/anomaly-event-store', () => ({
  getEvents: hoisted.anomalyStoreMock.getEvents,
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

vi.mock('@/lib/k8s-scaler', () => ({
  getScalingState: hoisted.scalerMock.getScalingState,
  scaleOpGeth: hoisted.scalerMock.scaleOpGeth,
  addScalingHistory: hoisted.scalerMock.addScalingHistory,
}));

vi.mock('@/lib/daily-accumulator', () => ({
  addScalingEvent: vi.fn(async () => undefined),
}));

vi.mock('@/lib/action-executor', () => ({
  executeAction: hoisted.actionExecutorMock.executeAction,
}));

vi.mock('@/lib/goal-planner', () => ({
  buildGoalPlan: hoisted.goalPlannerMock.buildGoalPlan,
  executeGoalPlan: hoisted.goalPlannerMock.executeGoalPlan,
  saveGoalPlan: hoisted.goalPlannerMock.saveGoalPlan,
}));

vi.mock('@/lib/redis-store', () => ({
  getStore: vi.fn(() => ({
    createMcpApprovalTicket: async (ticket: McpApprovalTicket) => {
      hoisted.approvalTicketMap.set(ticket.id, ticket);
    },
    getMcpApprovalTicket: async (ticketId: string) => hoisted.approvalTicketMap.get(ticketId) || null,
    consumeMcpApprovalTicket: async (ticketId: string) => {
      const ticket = hoisted.approvalTicketMap.get(ticketId) || null;
      if (ticket) hoisted.approvalTicketMap.delete(ticketId);
      return ticket;
    },
  })),
}));

describe('mcp-server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.approvalTicketMap.clear();

    process.env.MCP_SERVER_ENABLED = 'true';
    process.env.MCP_AUTH_MODE = 'api-key';
    process.env.MCP_APPROVAL_REQUIRED = 'true';
    process.env.SENTINAI_API_KEY = 'test-key';

    hoisted.metricsStoreMock.getRecentMetrics.mockResolvedValue([
      {
        timestamp: new Date().toISOString(),
        cpuUsage: 50,
        blockHeight: 100,
        blockInterval: 2.0,
        txPoolPending: 5,
        gasUsedRatio: 0.5,
        currentVcpu: 2,
      },
    ]);
    hoisted.metricsStoreMock.getMetricsCount.mockResolvedValue(1);
    hoisted.scalerMock.getScalingState.mockResolvedValue({
      currentVcpu: 2,
      currentMemoryGiB: 4,
      lastScalingTime: null,
      lastDecision: null,
      cooldownRemaining: 0,
      autoScalingEnabled: true,
    });
    hoisted.anomalyStoreMock.getEvents.mockResolvedValue({ events: [], total: 0, activeCount: 0 });
    hoisted.rcaMock.performRCA.mockResolvedValue({ id: 'rca-1' });
    hoisted.scalerMock.scaleOpGeth.mockResolvedValue({
      success: true,
      previousVcpu: 2,
      currentVcpu: 4,
      previousMemoryGiB: 4,
      currentMemoryGiB: 8,
      timestamp: new Date().toISOString(),
      message: 'scaled',
    });
    hoisted.actionExecutorMock.executeAction.mockResolvedValue({
      status: 'success',
      output: 'ok',
    });
    hoisted.goalPlannerMock.buildGoalPlan.mockImplementation((goal: string, dryRun: boolean) => ({
      planId: 'plan-1',
      goal,
      intent: 'custom',
      status: 'planned',
      dryRun,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      summary: 'plan created',
      steps: [],
    }));
    hoisted.goalPlannerMock.saveGoalPlan.mockImplementation((plan: any) => plan);
    hoisted.goalPlannerMock.executeGoalPlan.mockResolvedValue({
      plan: {
        planId: 'plan-1',
        goal: 'stabilize',
        intent: 'stabilize',
        status: 'completed',
        dryRun: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        summary: 'done',
        steps: [],
      },
      executionLog: [],
    });
  });

  it('should return error when MCP is disabled', async () => {
    process.env.MCP_SERVER_ENABLED = 'false';

    const response = await handleMcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      {
        requestId: 'req-1',
        readOnlyMode: false,
        allowScalerWriteInReadOnly: false,
      }
    );

    expect(response.error?.code).toBe(-32004);
  });

  it('should return tool manifest', async () => {
    const response = await handleMcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      {
        requestId: 'req-1',
        apiKey: 'test-key',
        readOnlyMode: false,
        allowScalerWriteInReadOnly: false,
      }
    );

    expect(response.error).toBeUndefined();
    expect((response.result as { tools: unknown[] }).tools.length).toBeGreaterThanOrEqual(5);
  });

  it('should support initialize method for standard MCP clients', async () => {
    const response = await handleMcpRequest(
      { jsonrpc: '2.0', id: 100, method: 'initialize', params: {} },
      {
        requestId: 'req-init',
        apiKey: 'test-key',
        readOnlyMode: false,
        allowScalerWriteInReadOnly: false,
      }
    );

    expect(response.error).toBeUndefined();
    const result = response.result as Record<string, any>;
    expect(result.protocolVersion).toBeDefined();
    expect(result.serverInfo?.name).toBe('sentinai-mcp');
  });

  it('should execute tools/call for standard MCP clients', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 101,
        method: 'tools/call',
        params: {
          name: 'get_metrics',
          arguments: { limit: 1 },
        },
      },
      {
        requestId: 'req-tools-call',
        apiKey: 'test-key',
        readOnlyMode: false,
        allowScalerWriteInReadOnly: false,
      }
    );

    expect(response.error).toBeUndefined();
    const result = response.result as Record<string, any>;
    expect(result.isError).toBe(false);
    expect(Array.isArray(result.content)).toBe(true);
    expect(hoisted.metricsStoreMock.getRecentMetrics).toHaveBeenCalledWith(1);
  });

  it('should execute get_metrics tool', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'get_metrics',
        params: { limit: 1 },
      },
      {
        requestId: 'req-2',
        apiKey: 'test-key',
        readOnlyMode: false,
        allowScalerWriteInReadOnly: false,
      }
    );

    expect(response.error).toBeUndefined();
    expect((response.result as { metricsCount: number }).metricsCount).toBe(1);
    expect(hoisted.metricsStoreMock.getRecentMetrics).toHaveBeenCalledWith(1);
  });

  it('should block write tool without approval token', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'scale_component',
        params: { targetVcpu: 4 },
      },
      {
        requestId: 'req-3',
        apiKey: 'test-key',
        readOnlyMode: false,
        allowScalerWriteInReadOnly: false,
      }
    );

    expect(response.error?.code).toBe(-32002);
    expect(hoisted.scalerMock.scaleOpGeth).not.toHaveBeenCalled();
  });

  it('should plan goal using MCP tool', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'plan_goal',
        params: { goal: 'stabilize l2' },
      },
      {
        requestId: 'req-goal-plan',
        apiKey: 'test-key',
        readOnlyMode: false,
        allowScalerWriteInReadOnly: false,
      }
    );

    expect(response.error).toBeUndefined();
    expect(hoisted.goalPlannerMock.buildGoalPlan).toHaveBeenCalled();
  });

  it('should block execute_goal_plan without approval token', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'execute_goal_plan',
        params: { goal: 'stabilize l2', dryRun: true, allowWrites: false },
      },
      {
        requestId: 'req-goal-exec',
        apiKey: 'test-key',
        readOnlyMode: false,
        allowScalerWriteInReadOnly: false,
      }
    );

    expect(response.error?.code).toBe(-32002);
    expect(hoisted.goalPlannerMock.executeGoalPlan).not.toHaveBeenCalled();
  });

  it('should allow scale_component with valid approval token', async () => {
    const approvalResponse = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'mcp.request_approval',
        params: {
          toolName: 'scale_component',
          toolParams: { targetVcpu: 4 },
          approvedBy: 'tester',
        },
      },
      {
        requestId: 'req-4',
        apiKey: 'test-key',
        readOnlyMode: false,
        allowScalerWriteInReadOnly: false,
      }
    );

    const token = (approvalResponse.result as { approvalToken: string }).approvalToken;
    expect(token).toBeTruthy();

    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'scale_component',
        params: { targetVcpu: 4, approvalToken: token },
      },
      {
        requestId: 'req-5',
        apiKey: 'test-key',
        readOnlyMode: false,
        allowScalerWriteInReadOnly: false,
      }
    );

    expect(response.error).toBeUndefined();
    expect((response.result as { success: boolean }).success).toBe(true);
    expect(hoisted.scalerMock.scaleOpGeth).toHaveBeenCalled();
  });

  it('should block restart_component in read-only mode', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'restart_component',
        params: { target: 'op-geth', approvalToken: 'dummy' },
      },
      {
        requestId: 'req-6',
        apiKey: 'test-key',
        readOnlyMode: true,
        allowScalerWriteInReadOnly: true,
      }
    );

    expect(response.error?.code).toBe(-32003);
    expect(hoisted.actionExecutorMock.executeAction).not.toHaveBeenCalled();
  });
});
