/**
 * MCP Server Core
 * Handles JSON-RPC tool invocation and policy enforcement.
 */

import { createHash, randomUUID } from 'crypto';
import { getChainPlugin } from '@/chains';
import { getStore } from '@/lib/redis-store';
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
import { executeAction } from '@/lib/action-executor';
import type { RemediationAction } from '@/types/remediation';
import type { TargetMemoryGiB, TargetVcpu } from '@/types/scaling';
import { DEFAULT_SCALING_CONFIG } from '@/types/scaling';
import type {
  McpApprovalTicket,
  McpAuthMode,
  McpJsonRpcId,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpRequestContext,
  McpServerConfig,
  McpToolDefinition,
  McpToolName,
} from '@/types/mcp';

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
  'scale_component',
  'restart_component',
]);

const TOOL_NAMES = new Set<McpToolName>([
  'get_metrics',
  'get_anomalies',
  'run_rca',
  'scale_component',
  'restart_component',
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

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    const body = keys
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

function stripApprovalToken(params: unknown): unknown {
  if (!isObject(params)) return params;
  const copied: Record<string, unknown> = { ...params };
  delete copied.approvalToken;
  return copied;
}

function hashParams(params: unknown): string {
  return createHash('sha256').update(stableSerialize(params)).digest('hex');
}

function requiresApiKey(authMode: McpAuthMode): boolean {
  return authMode === 'api-key' || authMode === 'dual';
}

function needsApprovalToken(config: McpServerConfig, toolName: McpToolName): boolean {
  if (!WRITE_TOOLS.has(toolName)) return false;
  if (config.authMode === 'approval-token' || config.authMode === 'dual') return true;
  return config.approvalRequired;
}

function getApprovalTokenFromParams(params: unknown): string | undefined {
  if (!isObject(params)) return undefined;
  return typeof params.approvalToken === 'string' ? params.approvalToken : undefined;
}

async function validateAndConsumeTicket(
  token: string,
  toolName: McpToolName,
  params: unknown
): Promise<{ ok: true; ticket: McpApprovalTicket } | { ok: false; reason: string }> {
  const ticket = await getStore().consumeMcpApprovalTicket(token);
  if (!ticket) {
    return { ok: false, reason: '승인 토큰이 없거나 이미 사용되었습니다.' };
  }

  if (ticket.toolName !== toolName) {
    return { ok: false, reason: '승인 토큰의 대상 도구가 일치하지 않습니다.' };
  }

  if (new Date(ticket.expiresAt).getTime() <= Date.now()) {
    return { ok: false, reason: '승인 토큰이 만료되었습니다.' };
  }

  const currentHash = hashParams(stripApprovalToken(params));
  if (ticket.paramsHash !== currentHash) {
    return { ok: false, reason: '승인 토큰의 요청 파라미터가 일치하지 않습니다.' };
  }

  return { ok: true, ticket };
}

function assertApiKeyForRequest(
  config: McpServerConfig,
  context: McpRequestContext
): string | null {
  if (!requiresApiKey(config.authMode)) return null;

  const configuredApiKey = process.env.SENTINAI_API_KEY;
  if (!configuredApiKey) {
    return 'MCP 인증 모드가 API 키를 요구하지만 SENTINAI_API_KEY가 설정되지 않았습니다.';
  }
  if (context.apiKey !== configuredApiKey) {
    return '유효하지 않은 x-api-key 입니다.';
  }
  return null;
}

function isReadOnlyWriteBlocked(context: McpRequestContext, toolName: McpToolName): boolean {
  if (!context.readOnlyMode) return false;
  if (!WRITE_TOOLS.has(toolName)) return false;

  if (toolName === 'scale_component' && context.allowScalerWriteInReadOnly) {
    return false;
  }
  return true;
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
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);

  const ticket: McpApprovalTicket = {
    id: randomUUID(),
    toolName,
    paramsHash: hashParams(stripApprovalToken(params.toolParams)),
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    approvedBy: typeof params.approvedBy === 'string' ? params.approvedBy : undefined,
    reason: typeof params.reason === 'string' ? params.reason : undefined,
  };

  await getStore().createMcpApprovalTicket(ticket);

  return {
    jsonrpc: '2.0',
    id: null,
    result: {
      approvalToken: ticket.id,
      toolName: ticket.toolName,
      expiresAt: ticket.expiresAt,
      ttlSeconds,
    },
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

  return {
    success: result.success,
    previousVcpu: result.previousVcpu,
    currentVcpu: result.currentVcpu,
    dryRun,
    message: result.message,
    error: result.error,
    timestamp: result.timestamp,
  };
}

async function executeRestartComponent(params: unknown): Promise<unknown> {
  const p = isObject(params) ? params : {};
  const target =
    typeof p.target === 'string' && p.target.trim().length > 0
      ? p.target.trim()
      : getChainPlugin().primaryExecutionClient;

  const action: RemediationAction = {
    type: 'restart_pod',
    safetyLevel: 'guarded',
    target,
  };

  const result = await executeAction(action, DEFAULT_SCALING_CONFIG);
  return {
    target,
    result,
  };
}

async function executeTool(toolName: McpToolName, params: unknown): Promise<unknown> {
  switch (toolName) {
    case 'get_metrics':
      return executeGetMetrics(params);
    case 'get_anomalies':
      return executeGetAnomalies(params);
    case 'run_rca':
      return executeRunRca();
    case 'scale_component':
      return executeScaleComponent(params);
    case 'restart_component':
      return executeRestartComponent(params);
    default: {
      const exhaustiveCheck: never = toolName;
      throw new Error(`Unknown MCP tool: ${exhaustiveCheck}`);
    }
  }
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
    const configuredApiKey = process.env.SENTINAI_API_KEY;
    if (configuredApiKey && context.apiKey !== configuredApiKey) {
      return buildError(id, MCP_ERROR.UNAUTHORIZED, '승인 토큰 발급 권한이 없습니다.');
    }

    const ticketResponse = await issueApprovalTicket(request.params, config);
    return {
      ...ticketResponse,
      id,
    };
  }

  const toolName = normalizeToolName(request.method);
  if (!toolName) {
    return buildError(id, MCP_ERROR.METHOD_NOT_FOUND, `지원하지 않는 MCP 메서드입니다: ${request.method}`);
  }

  const authError = assertApiKeyForRequest(config, context);
  if (authError) {
    return buildError(id, MCP_ERROR.UNAUTHORIZED, authError);
  }

  if (isReadOnlyWriteBlocked(context, toolName)) {
    return buildError(
      id,
      MCP_ERROR.FORBIDDEN_READ_ONLY,
      '읽기 전용 모드에서는 해당 MCP 쓰기 도구를 실행할 수 없습니다.'
    );
  }

  const startedAt = Date.now();
  try {
    if (needsApprovalToken(config, toolName)) {
      const token = context.approvalToken || getApprovalTokenFromParams(request.params);
      if (!token) {
        return buildError(id, MCP_ERROR.APPROVAL_REQUIRED, '승인 토큰이 필요합니다.');
      }

      const ticketResult = await validateAndConsumeTicket(token, toolName, request.params);
      if (!ticketResult.ok) {
        return buildError(id, MCP_ERROR.APPROVAL_REQUIRED, ticketResult.reason);
      }
    }

    const result = await executeTool(toolName, request.params);
    return {
      jsonrpc: '2.0',
      id,
      result: {
        ...((isObject(result) ? result : { value: result }) as Record<string, unknown>),
        audit: {
          requestId: context.requestId,
          toolName,
          durationMs: Date.now() - startedAt,
          executedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return buildError(id, MCP_ERROR.INTERNAL_ERROR, `MCP 도구 실행 실패: ${message}`);
  }
}
