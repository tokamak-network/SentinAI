/**
 * MCP Server Core
 * Handles JSON-RPC tool invocation and policy enforcement.
 */

import { getChainPlugin } from '@/chains';
import { getRecentMetrics, getMetricsCount } from '@/lib/metrics-store';
import { getEvents } from '@/lib/anomaly-event-store';
import { detectAnomalies } from '@/lib/anomaly-detector';
import { getAllLiveLogs, generateMockLogs } from '@/lib/log-ingester';
import { addRCAHistory, performRCA } from '@/lib/rca-engine';
import {
  addScalingHistory,
  getScalingState,
  scaleOpGeth,
} from '@/lib/k8s-scaler';
import { addScalingEvent } from '@/lib/daily-accumulator';
import { buildGoalPlan, executeGoalPlan, saveGoalPlan } from '@/lib/goal-planner';
import { restartComponent, runHealthDiagnostics } from '@/lib/component-operator';
import { switchL1RpcUrl, updateProxydBackendUrl } from '@/lib/l1-rpc-operator';
import { verifyOperationOutcome } from '@/lib/operation-verifier';
import { buildRollbackPlan, runRollbackPlan } from '@/lib/rollback-runner';
import {
  getApprovalTokenFromParams,
  issueApprovalTicket as issueApprovalTicketCore,
  validateAndConsumeApprovalTicket,
} from '@/lib/approval-engine';
import {
  evaluateMcpApprovalIssuePolicy,
  evaluateMcpToolPolicy,
} from '@/lib/policy-engine';
import type { TargetMemoryGiB, TargetVcpu } from '@/types/scaling';
import { DEFAULT_SCALING_CONFIG } from '@/types/scaling';
import type {
  McpAuthMode,
  McpJsonRpcId,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpRequestContext,
  McpServerConfig,
  McpToolDefinition,
  McpToolName,
} from '@/types/mcp';
import type { PolicyReasonCode } from '@/types/policy';
import type { OperationActionType } from '@/types/operation-control';

const MCP_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNAUTHORIZED: -32001,
  APPROVAL_REQUIRED: -32002,
  FORBIDDEN_READ_ONLY: -32003,
  DISABLED: -32004,
} as const;

const WRITE_TOOLS = new Set<McpToolName>([
  'execute_goal_plan',
  'scale_component',
  'restart_component',
  'restart_batcher',
  'restart_proposer',
  'switch_l1_rpc',
  'update_proxyd_backend',
]);

const TOOL_NAMES = new Set<McpToolName>([
  'get_metrics',
  'get_anomalies',
  'run_rca',
  'plan_goal',
  'execute_goal_plan',
  'scale_component',
  'restart_component',
  'restart_batcher',
  'restart_proposer',
  'switch_l1_rpc',
  'update_proxyd_backend',
  'run_health_diagnostics',
]);

const DEFAULT_APPROVAL_TTL_SECONDS = 300;

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'get_metrics',
    description: '최근 메트릭과 스케일링 상태를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 60, default: 5 },
      },
    },
    writeOperation: false,
  },
  {
    name: 'get_anomalies',
    description: '이상 이벤트 목록을 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
        offset: { type: 'number', minimum: 0, default: 0 },
      },
    },
    writeOperation: false,
  },
  {
    name: 'run_rca',
    description: '즉시 RCA 분석을 수행합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    writeOperation: false,
  },
  {
    name: 'plan_goal',
    description: '자연어 목표를 실행 계획으로 분해합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        dryRun: { type: 'boolean', default: true },
      },
      required: ['goal'],
    },
    writeOperation: false,
  },
  {
    name: 'execute_goal_plan',
    description: '목표 계획을 실행합니다. 기본은 dry-run이며, allowWrites=true면 실제 변경을 수행합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        dryRun: { type: 'boolean', default: true },
        allowWrites: { type: 'boolean', default: false },
        approvalToken: { type: 'string' },
      },
      required: ['goal'],
    },
    writeOperation: true,
  },
  {
    name: 'scale_component',
    description: '기본 실행 컴포넌트(op-geth) 리소스를 스케일링합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        targetVcpu: { type: 'number', enum: [1, 2, 4, 8] },
        reason: { type: 'string' },
        dryRun: { type: 'boolean', default: false },
        approvalToken: { type: 'string' },
      },
      required: ['targetVcpu'],
    },
    writeOperation: true,
  },
  {
    name: 'restart_component',
    description: '선택한 컴포넌트를 재시작합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        approvalToken: { type: 'string' },
      },
    },
    writeOperation: true,
  },
  {
    name: 'restart_batcher',
    description: '배처 컴포넌트를 재시작합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', default: false },
        approvalToken: { type: 'string' },
      },
    },
    writeOperation: true,
  },
  {
    name: 'restart_proposer',
    description: '프로포저 컴포넌트를 재시작합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', default: false },
        approvalToken: { type: 'string' },
      },
    },
    writeOperation: true,
  },
  {
    name: 'switch_l1_rpc',
    description: 'L1 RPC 활성 엔드포인트를 전환합니다. targetUrl 미지정 시 다음 건강한 엔드포인트로 failover합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        targetUrl: { type: 'string' },
        reason: { type: 'string' },
        dryRun: { type: 'boolean', default: false },
        approvalToken: { type: 'string' },
      },
    },
    writeOperation: true,
  },
  {
    name: 'update_proxyd_backend',
    description: '지정한 Proxyd backend RPC URL을 교체합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        backendName: { type: 'string' },
        newRpcUrl: { type: 'string' },
        reason: { type: 'string' },
        dryRun: { type: 'boolean', default: false },
        approvalToken: { type: 'string' },
      },
      required: ['backendName', 'newRpcUrl'],
    },
    writeOperation: true,
  },
  {
    name: 'run_health_diagnostics',
    description: '메트릭, 이상 이벤트, L1 RPC, 주요 컴포넌트 상태를 종합 점검합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    writeOperation: false,
  },
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function parseAuthMode(raw: string | undefined): McpAuthMode {
  if (raw === 'approval-token' || raw === 'dual' || raw === 'api-key') {
    return raw;
  }
  return 'api-key';
}

export function getMcpConfig(): McpServerConfig {
  return {
    enabled: process.env.MCP_SERVER_ENABLED === 'true',
    authMode: parseAuthMode(process.env.MCP_AUTH_MODE),
    approvalRequired: process.env.MCP_APPROVAL_REQUIRED !== 'false',
    approvalTtlSeconds: clampNumber(
      Number.parseInt(process.env.MCP_APPROVAL_TTL_SECONDS || `${DEFAULT_APPROVAL_TTL_SECONDS}`, 10),
      30,
      3600,
      DEFAULT_APPROVAL_TTL_SECONDS
    ),
  };
}

export function getMcpToolManifest(): McpToolDefinition[] {
  return [...MCP_TOOLS];
}

function buildError(
  id: McpJsonRpcId,
  code: number,
  message: string,
  data?: unknown
): McpJsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  };
}

function normalizeToolName(method: string): McpToolName | null {
  const normalized = method.startsWith('tool.') ? method.slice(5) : method;
  return TOOL_NAMES.has(normalized as McpToolName)
    ? (normalized as McpToolName)
    : null;
}

function mapPolicyReasonToMcpErrorCode(reasonCode: PolicyReasonCode): number {
  if (reasonCode === 'api_key_invalid' || reasonCode === 'api_key_not_configured') {
    return MCP_ERROR.UNAUTHORIZED;
  }
  if (reasonCode === 'read_only_write_blocked') {
    return MCP_ERROR.FORBIDDEN_READ_ONLY;
  }
  if (reasonCode === 'approval_required') {
    return MCP_ERROR.APPROVAL_REQUIRED;
  }
  return MCP_ERROR.INTERNAL_ERROR;
}

async function issueApprovalTicket(
  params: unknown,
  config: McpServerConfig
): Promise<McpJsonRpcResponse> {
  if (!isObject(params)) {
    return buildError(null, MCP_ERROR.INVALID_PARAMS, '승인 요청 파라미터가 올바르지 않습니다.');
  }

  const toolName = normalizeToolName(String(params.toolName || ''));
  if (!toolName || !WRITE_TOOLS.has(toolName)) {
    return buildError(null, MCP_ERROR.INVALID_PARAMS, '승인 요청은 쓰기 도구에만 발급할 수 있습니다.');
  }

  const ttlSeconds = clampNumber(
    Number.parseInt(String(params.ttlSeconds ?? config.approvalTtlSeconds), 10),
    30,
    3600,
    config.approvalTtlSeconds
  );
  const issueResult = await issueApprovalTicketCore({
    toolName,
    toolParams: params.toolParams,
    ttlSeconds,
    approvedBy: typeof params.approvedBy === 'string' ? params.approvedBy : undefined,
    reason: typeof params.reason === 'string' ? params.reason : undefined,
  });

  return {
    jsonrpc: '2.0',
    id: null,
    result: issueResult,
  };
}

async function executeGetMetrics(params: unknown): Promise<unknown> {
  const p = isObject(params) ? params : {};
  const limit = clampNumber(p.limit, 1, 60, 5);

  const [recentMetrics, metricsCount, scalingState] = await Promise.all([
    getRecentMetrics(limit),
    getMetricsCount(),
    getScalingState(),
  ]);

  return {
    metricsCount,
    latest: recentMetrics.length > 0 ? recentMetrics[recentMetrics.length - 1] : null,
    recent: recentMetrics,
    scaling: {
      currentVcpu: scalingState.currentVcpu,
      currentMemoryGiB: scalingState.currentMemoryGiB,
      autoScalingEnabled: scalingState.autoScalingEnabled,
      cooldownRemaining: scalingState.cooldownRemaining,
    },
    generatedAt: new Date().toISOString(),
  };
}

async function executeGetAnomalies(params: unknown): Promise<unknown> {
  const p = isObject(params) ? params : {};
  const limit = clampNumber(p.limit, 1, 100, 20);
  const offset = clampNumber(p.offset, 0, 1_000_000, 0);
  return getEvents(limit, offset);
}

async function executeRunRca(): Promise<unknown> {
  const metrics = await getRecentMetrics();

  let anomalies: ReturnType<typeof detectAnomalies> = [];
  if (metrics.length > 1) {
    const current = metrics[metrics.length - 1];
    anomalies = detectAnomalies(current, metrics.slice(0, -1));
  }

  let logsSource: 'live' | 'mock' = 'live';
  let logs: Record<string, string>;

  try {
    logs = await getAllLiveLogs();
  } catch {
    logs = generateMockLogs('normal');
    logsSource = 'mock';
  }

  const result = await performRCA(anomalies, logs, metrics);
  addRCAHistory(result, 'manual');

  return {
    result,
    detectedAnomalyCount: anomalies.filter((item) => item.isAnomaly).length,
    logsSource,
  };
}

async function executePlanGoal(params: unknown): Promise<unknown> {
  if (!isObject(params)) {
    throw new Error('goal 파라미터가 필요합니다.');
  }

  const goal = typeof params.goal === 'string' ? params.goal.trim() : '';
  if (!goal) {
    throw new Error('goal 문자열이 비어 있습니다.');
  }

  const dryRun = params.dryRun !== false;
  const plan = await buildGoalPlan(goal, dryRun);
  return {
    plan: saveGoalPlan(plan),
  };
}

async function executeGoalPlanTool(params: unknown): Promise<unknown> {
  if (!isObject(params)) {
    throw new Error('goal 파라미터가 필요합니다.');
  }

  const goal = typeof params.goal === 'string' ? params.goal.trim() : '';
  if (!goal) {
    throw new Error('goal 문자열이 비어 있습니다.');
  }

  const dryRun = params.dryRun !== false;
  const allowWrites = params.allowWrites === true;

  const plan = await buildGoalPlan(goal, dryRun);
  const result = await executeGoalPlan(plan, {
    dryRun,
    allowWrites,
    initiatedBy: 'mcp',
  });

  return result;
}

async function runOperationControl(
  actionType: OperationActionType,
  dryRun: boolean,
  expected: Record<string, unknown>,
  observed: Record<string, unknown>,
  execution: Record<string, unknown>
): Promise<{
  status: 'verified' | 'rollback_succeeded' | 'rollback_failed' | 'verification_failed' | 'skipped';
  verification: Awaited<ReturnType<typeof verifyOperationOutcome>>;
  rollback?: Awaited<ReturnType<typeof runRollbackPlan>>;
}> {
  const verification = await verifyOperationOutcome({
    actionType,
    dryRun,
    expected,
    observed,
  });

  if (verification.passed) {
    return {
      status: dryRun ? 'skipped' : 'verified',
      verification,
    };
  }

  const rollbackPlan = buildRollbackPlan({
    actionType,
    execution,
  });

  const rollback = await runRollbackPlan(rollbackPlan, dryRun);
  if (rollback.success) {
    return {
      status: 'rollback_succeeded',
      verification,
      rollback,
    };
  }

  return {
    status: rollback.attempted ? 'rollback_failed' : 'verification_failed',
    verification,
    rollback,
  };
}

async function executeScaleComponent(params: unknown): Promise<unknown> {
  if (!isObject(params)) {
    throw new Error('스케일링 파라미터가 올바르지 않습니다.');
  }

  const targetVcpuRaw = params.targetVcpu;
  if (typeof targetVcpuRaw !== 'number' || ![1, 2, 4, 8].includes(targetVcpuRaw)) {
    throw new Error('targetVcpu 값은 1, 2, 4, 8 중 하나여야 합니다.');
  }

  const targetVcpu = targetVcpuRaw as TargetVcpu;
  const targetMemoryGiB = (targetVcpu * 2) as TargetMemoryGiB;
  const dryRun = params.dryRun === true;
  const reason = typeof params.reason === 'string' ? params.reason : 'MCP manual scaling';

  const result = await scaleOpGeth(
    targetVcpu,
    targetMemoryGiB,
    DEFAULT_SCALING_CONFIG,
    dryRun
  );

  if (!dryRun && result.success && result.previousVcpu !== result.currentVcpu) {
    await addScalingHistory({
      timestamp: result.timestamp,
      fromVcpu: result.previousVcpu,
      toVcpu: result.currentVcpu,
      reason,
      triggeredBy: 'manual',
    });

    await addScalingEvent({
      timestamp: result.timestamp,
      fromVcpu: result.previousVcpu,
      toVcpu: result.currentVcpu,
      trigger: 'manual',
      reason,
    });
  }

  const operationControl = await runOperationControl(
    'scale_component',
    dryRun,
    { targetVcpu },
    { currentVcpu: result.currentVcpu },
    {
      previousVcpu: result.previousVcpu,
      currentVcpu: result.currentVcpu,
    }
  );

  return {
    success: result.success && (operationControl.status === 'verified' || operationControl.status === 'skipped' || operationControl.status === 'rollback_succeeded'),
    previousVcpu: result.previousVcpu,
    currentVcpu: result.currentVcpu,
    dryRun,
    message: result.message,
    error: result.error,
    timestamp: result.timestamp,
    operationControl,
  };
}

async function executeRestartComponent(params: unknown): Promise<unknown> {
  const p = isObject(params) ? params : {};
  const target =
    typeof p.target === 'string' && p.target.trim().length > 0
      ? p.target.trim()
      : getChainPlugin().primaryExecutionClient;

  const dryRun = p.dryRun === true;
  const restartResult = await restartComponent({ target, dryRun });
  const operationControl = await runOperationControl(
    'restart_component',
    dryRun,
    { target },
    { target, success: restartResult.success },
    { target }
  );

  return {
    target,
    success: restartResult.success && (operationControl.status === 'verified' || operationControl.status === 'skipped' || operationControl.status === 'rollback_succeeded'),
    result: restartResult,
    operationControl,
  };
}

async function executeRestartRoleComponent(role: 'batcher' | 'proposer', params: unknown): Promise<unknown> {
  const p = isObject(params) ? params : {};
  const dryRun = p.dryRun === true;
  const plugin = getChainPlugin();
  const target = typeof plugin.normalizeComponentName === 'function'
    ? plugin.normalizeComponentName(role)
    : role;
  if (target === 'system') {
    throw new Error(`${role} 컴포넌트를 현재 체인에서 찾을 수 없습니다.`);
  }

  const restartResult = await restartComponent({ target, dryRun });
  const actionType: OperationActionType = role === 'batcher' ? 'restart_batcher' : 'restart_proposer';
  const operationControl = await runOperationControl(
    actionType,
    dryRun,
    { target },
    { target, success: restartResult.success },
    { target }
  );

  return {
    role,
    target,
    success: restartResult.success && (operationControl.status === 'verified' || operationControl.status === 'skipped' || operationControl.status === 'rollback_succeeded'),
    result: restartResult,
    operationControl,
  };
}

async function executeSwitchL1Rpc(params: unknown): Promise<unknown> {
  const p = isObject(params) ? params : {};
  const targetUrl = typeof p.targetUrl === 'string' ? p.targetUrl : undefined;
  const reason = typeof p.reason === 'string' ? p.reason : undefined;
  const dryRun = p.dryRun === true;

  const switchResult = await switchL1RpcUrl({ targetUrl, reason, dryRun });
  const operationControl = await runOperationControl(
    'switch_l1_rpc',
    dryRun,
    { targetUrl: switchResult.toUrlRaw },
    { activeUrl: switchResult.toUrlRaw },
    {
      fromUrl: switchResult.fromUrlRaw,
      previousUrl: switchResult.fromUrlRaw,
      toUrl: switchResult.toUrlRaw,
    }
  );

  return {
    ...switchResult,
    success: switchResult.success && (operationControl.status === 'verified' || operationControl.status === 'skipped' || operationControl.status === 'rollback_succeeded'),
    operationControl,
  };
}

async function executeUpdateProxydBackend(params: unknown): Promise<unknown> {
  if (!isObject(params)) {
    throw new Error('backendName/newRpcUrl 파라미터가 필요합니다.');
  }

  const backendName = typeof params.backendName === 'string' ? params.backendName : '';
  const newRpcUrl = typeof params.newRpcUrl === 'string' ? params.newRpcUrl : '';
  const reason = typeof params.reason === 'string' ? params.reason : undefined;
  const dryRun = params.dryRun === true;
  if (!backendName || !newRpcUrl) {
    throw new Error('backendName/newRpcUrl 파라미터가 필요합니다.');
  }

  const updateResult = await updateProxydBackendUrl({
    backendName,
    newRpcUrl,
    reason,
    dryRun,
  });

  const operationControl = await runOperationControl(
    'update_proxyd_backend',
    dryRun,
    { backendName, newRpcUrl: updateResult.newUrlRaw },
    {
      backendName: updateResult.backendName,
      newRpcUrl: updateResult.newUrlRaw,
      success: updateResult.success,
    },
    {
      backendName: updateResult.backendName,
      oldUrl: updateResult.oldUrlRaw,
      newUrl: updateResult.newUrlRaw,
    }
  );

  return {
    ...updateResult,
    success: updateResult.success && (operationControl.status === 'verified' || operationControl.status === 'skipped' || operationControl.status === 'rollback_succeeded'),
    operationControl,
  };
}

async function executeRunHealthDiagnostics(): Promise<unknown> {
  return runHealthDiagnostics();
}

async function executeTool(toolName: McpToolName, params: unknown): Promise<unknown> {
  switch (toolName) {
    case 'get_metrics':
      return executeGetMetrics(params);
    case 'get_anomalies':
      return executeGetAnomalies(params);
    case 'run_rca':
      return executeRunRca();
    case 'plan_goal':
      return executePlanGoal(params);
    case 'execute_goal_plan':
      return executeGoalPlanTool(params);
    case 'scale_component':
      return executeScaleComponent(params);
    case 'restart_component':
      return executeRestartComponent(params);
    case 'restart_batcher':
      return executeRestartRoleComponent('batcher', params);
    case 'restart_proposer':
      return executeRestartRoleComponent('proposer', params);
    case 'switch_l1_rpc':
      return executeSwitchL1Rpc(params);
    case 'update_proxyd_backend':
      return executeUpdateProxydBackend(params);
    case 'run_health_diagnostics':
      return executeRunHealthDiagnostics();
    default: {
      const exhaustiveCheck: never = toolName;
      throw new Error(`Unknown MCP tool: ${exhaustiveCheck}`);
    }
  }
}

const MCP_PROTOCOL_VERSION = '2025-03-26';

function toStandardToolCallResult(
  payload: Record<string, unknown>,
  isError: boolean
): Record<string, unknown> {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
    isError,
  };
}

async function invokeToolWithGuards(
  id: McpJsonRpcId,
  toolName: McpToolName,
  params: unknown,
  context: McpRequestContext,
  config: McpServerConfig,
  standardCall: boolean
): Promise<McpJsonRpcResponse> {
  const writeOperation = WRITE_TOOLS.has(toolName);
  const policyDecision = evaluateMcpToolPolicy({
    toolName,
    writeOperation,
    authMode: config.authMode,
    approvalRequired: config.approvalRequired,
    apiKeyProvided: context.apiKey,
    configuredApiKey: process.env.SENTINAI_API_KEY,
    readOnlyMode: context.readOnlyMode,
    allowScalerWriteInReadOnly: context.allowScalerWriteInReadOnly,
  });

  if (policyDecision.decision === 'deny') {
    return buildError(
      id,
      mapPolicyReasonToMcpErrorCode(policyDecision.reasonCode),
      policyDecision.message,
      { reasonCode: policyDecision.reasonCode }
    );
  }

  const startedAt = Date.now();
  try {
    if (policyDecision.decision === 'require_approval' || policyDecision.decision === 'require_multi_approval') {
      const token = context.approvalToken || getApprovalTokenFromParams(params);
      if (!token) {
        return buildError(id, MCP_ERROR.APPROVAL_REQUIRED, policyDecision.message, {
          reasonCode: policyDecision.reasonCode,
        });
      }

      const ticketResult = await validateAndConsumeApprovalTicket(token, toolName, params);
      if (!ticketResult.ok) {
        return buildError(id, MCP_ERROR.APPROVAL_REQUIRED, ticketResult.message, {
          reasonCode: ticketResult.reasonCode,
        });
      }
    }

    const result = await executeTool(toolName, params);
    const payload = {
      ...((isObject(result) ? result : { value: result }) as Record<string, unknown>),
      audit: {
        requestId: context.requestId,
        toolName,
        durationMs: Date.now() - startedAt,
        executedAt: new Date().toISOString(),
      },
    };

    if (standardCall) {
      return {
        jsonrpc: '2.0',
        id,
        result: toStandardToolCallResult(payload, false),
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      result: payload,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (standardCall) {
      return {
        jsonrpc: '2.0',
        id,
        result: toStandardToolCallResult(
          {
            error: message,
            toolName,
          },
          true
        ),
      };
    }
    return buildError(id, MCP_ERROR.INTERNAL_ERROR, `MCP 도구 실행 실패: ${message}`);
  }
}

function parseStandardToolCall(
  params: unknown
): { toolName: McpToolName; argumentsPayload: unknown } | null {
  if (!isObject(params) || typeof params.name !== 'string') return null;
  const toolName = normalizeToolName(params.name);
  if (!toolName) return null;
  return {
    toolName,
    argumentsPayload: params.arguments,
  };
}

export async function handleMcpRequest(
  payload: unknown,
  context: McpRequestContext
): Promise<McpJsonRpcResponse> {
  const config = getMcpConfig();
  if (!config.enabled) {
    return buildError(null, MCP_ERROR.DISABLED, 'MCP 서버가 비활성화되어 있습니다.');
  }

  if (!isObject(payload)) {
    return buildError(null, MCP_ERROR.INVALID_REQUEST, 'JSON-RPC 요청 형식이 올바르지 않습니다.');
  }

  const request = payload as Partial<McpJsonRpcRequest>;
  const id: McpJsonRpcId = request.id ?? null;

  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return buildError(id, MCP_ERROR.INVALID_REQUEST, 'jsonrpc 또는 method 필드가 올바르지 않습니다.');
  }

  if (request.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: {
          name: 'sentinai-mcp',
          version: '1.0.0',
        },
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
      },
    };
  }

  if (request.method === 'notifications/initialized') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        acknowledged: true,
      },
    };
  }

  if (request.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: getMcpToolManifest(),
        authMode: config.authMode,
        approvalRequired: config.approvalRequired,
      },
    };
  }

  if (request.method === 'mcp.request_approval') {
    const policyDecision = evaluateMcpApprovalIssuePolicy({
      apiKeyProvided: context.apiKey,
      configuredApiKey: process.env.SENTINAI_API_KEY,
    });
    if (policyDecision.decision === 'deny') {
      return buildError(
        id,
        mapPolicyReasonToMcpErrorCode(policyDecision.reasonCode),
        policyDecision.message,
        { reasonCode: policyDecision.reasonCode }
      );
    }

    const ticketResponse = await issueApprovalTicket(request.params, config);
    return {
      ...ticketResponse,
      id,
    };
  }

  if (request.method === 'tools/call') {
    const parsed = parseStandardToolCall(request.params);
    if (!parsed) {
      return buildError(id, MCP_ERROR.INVALID_PARAMS, 'tools/call 파라미터가 올바르지 않습니다.');
    }
    return invokeToolWithGuards(
      id,
      parsed.toolName,
      parsed.argumentsPayload,
      context,
      config,
      true
    );
  }

  const toolName = normalizeToolName(request.method);
  if (!toolName) {
    return buildError(id, MCP_ERROR.METHOD_NOT_FOUND, `지원하지 않는 MCP 메서드입니다: ${request.method}`);
  }

  return invokeToolWithGuards(id, toolName, request.params, context, config, false);
}
