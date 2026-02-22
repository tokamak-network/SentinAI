/**
 * Policy Engine Types
 * Centralized authorization and safety decision contracts.
 */

import type { McpAuthMode, McpToolName } from '@/types/mcp';

export type PolicyDecision =
  | 'allow'
  | 'deny'
  | 'require_approval'
  | 'require_multi_approval';

export type PolicyReasonCode =
  | 'allowed'
  | 'api_key_not_configured'
  | 'api_key_invalid'
  | 'read_only_write_blocked'
  | 'approval_required';

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  reasonCode: PolicyReasonCode;
  message: string;
}

export interface McpToolPolicyInput {
  toolName: McpToolName;
  writeOperation: boolean;
  authMode: McpAuthMode;
  approvalRequired: boolean;
  apiKeyProvided?: string;
  configuredApiKey?: string;
  readOnlyMode: boolean;
  allowScalerWriteInReadOnly: boolean;
}

export interface McpApprovalIssuePolicyInput {
  apiKeyProvided?: string;
  configuredApiKey?: string;
}

export interface GoalExecutionPolicyInput {
  autoExecute: boolean;
  allowWrites: boolean;
  readOnlyMode: boolean;
}

export type ApprovalValidationReasonCode =
  | 'approval_token_missing_or_consumed'
  | 'approval_tool_mismatch'
  | 'approval_token_expired'
  | 'approval_params_mismatch';

export interface ApprovalValidationResultOk {
  ok: true;
}

export interface ApprovalValidationResultFail {
  ok: false;
  reasonCode: ApprovalValidationReasonCode;
  message: string;
}

export type ApprovalValidationResult =
  | ApprovalValidationResultOk
  | ApprovalValidationResultFail;

