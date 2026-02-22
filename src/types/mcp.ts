/**
 * MCP (Model Context Protocol) Types
 * JSON-RPC tool invocation contract for SentinAI.
 */

export type McpToolName =
  | 'get_metrics'
  | 'get_anomalies'
  | 'run_rca'
  | 'plan_goal'
  | 'execute_goal_plan'
  | 'scale_component'
  | 'restart_component';

export type McpAuthMode = 'api-key' | 'approval-token' | 'dual';

export type McpJsonRpcId = string | number | null;

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: McpJsonRpcId;
  method: string;
  params?: unknown;
}

export interface McpJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: McpJsonRpcId;
  result?: unknown;
  error?: McpJsonRpcError;
}

export interface McpToolDefinition {
  name: McpToolName;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  writeOperation: boolean;
}

export interface McpServerConfig {
  enabled: boolean;
  authMode: McpAuthMode;
  approvalRequired: boolean;
  approvalTtlSeconds: number;
}

export interface McpRequestContext {
  requestId: string;
  apiKey?: string;
  approvalToken?: string;
  readOnlyMode: boolean;
  allowScalerWriteInReadOnly: boolean;
}

export interface McpApprovalTicket {
  id: string;
  toolName: McpToolName;
  paramsHash: string;
  createdAt: string;
  expiresAt: string;
  approvedBy?: string;
  reason?: string;
}
