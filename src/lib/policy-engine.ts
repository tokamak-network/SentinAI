/**
 * Policy Engine
 * Shared policy checks across MCP tools and API routes.
 */

import type {
  GoalExecutionPolicyInput,
  McpApprovalIssuePolicyInput,
  McpToolPolicyInput,
  PolicyEvaluationResult,
} from '@/types/policy';
import { getRuntimeAutonomyPolicy } from '@/lib/autonomy-policy';

export function requiresApiKey(authMode: McpToolPolicyInput['authMode']): boolean {
  return authMode === 'api-key' || authMode === 'dual';
}

export function requiresApproval(
  authMode: McpToolPolicyInput['authMode'],
  approvalRequired: boolean,
  writeOperation: boolean
): boolean {
  if (!writeOperation) return false;
  if (authMode === 'approval-token' || authMode === 'dual') return true;
  return approvalRequired;
}

export function evaluateMcpToolPolicy(input: McpToolPolicyInput): PolicyEvaluationResult {
  if (requiresApiKey(input.authMode)) {
    if (!input.configuredApiKey) {
      return {
        decision: 'deny',
        reasonCode: 'api_key_not_configured',
        message: 'MCP 인증 모드가 API 키를 요구하지만 SENTINAI_API_KEY가 설정되지 않았습니다.',
      };
    }

    if (input.apiKeyProvided !== input.configuredApiKey) {
      return {
        decision: 'deny',
        reasonCode: 'api_key_invalid',
        message: '유효하지 않은 x-api-key 입니다.',
      };
    }
  }

  if (input.readOnlyMode && input.writeOperation) {
    const scalerAllowed = input.toolName === 'scale_component' && input.allowScalerWriteInReadOnly;
    if (!scalerAllowed) {
      return {
        decision: 'deny',
        reasonCode: 'read_only_write_blocked',
        message: '읽기 전용 모드에서는 해당 MCP 쓰기 도구를 실행할 수 없습니다.',
      };
    }
  }

  if (requiresApproval(input.authMode, input.approvalRequired, input.writeOperation)) {
    return {
      decision: 'require_approval',
      reasonCode: 'approval_required',
      message: '승인 토큰이 필요합니다.',
    };
  }

  return {
    decision: 'allow',
    reasonCode: 'allowed',
    message: 'allowed',
  };
}

export function evaluateMcpApprovalIssuePolicy(
  input: McpApprovalIssuePolicyInput
): PolicyEvaluationResult {
  if (input.configuredApiKey && input.apiKeyProvided !== input.configuredApiKey) {
    return {
      decision: 'deny',
      reasonCode: 'api_key_invalid',
      message: '승인 토큰 발급 권한이 없습니다.',
    };
  }

  return {
    decision: 'allow',
    reasonCode: 'allowed',
    message: 'allowed',
  };
}

export function evaluateGoalExecutionPolicy(
  input: GoalExecutionPolicyInput
): PolicyEvaluationResult {
  if (input.autoExecute && input.allowWrites && input.readOnlyMode) {
    return {
      decision: 'deny',
      reasonCode: 'read_only_write_blocked',
      message: 'Write execution is blocked in read-only mode',
    };
  }

  const policy = input.autonomyPolicy || getRuntimeAutonomyPolicy();
  const risk = input.risk || 'medium';
  const confidence = typeof input.confidence === 'number' ? input.confidence : 1;
  const confidenceThreshold = input.allowWrites ? policy.minConfidenceWrite : policy.minConfidenceDryRun;

  if (input.autoExecute && (policy.level === 'A0' || policy.level === 'A1')) {
    return {
      decision: 'deny',
      reasonCode: 'autonomy_level_blocked',
      message: `Autonomous execution blocked at level ${policy.level}`,
    };
  }

  if (input.autoExecute && input.allowWrites && policy.level === 'A2') {
    return {
      decision: 'deny',
      reasonCode: 'autonomy_level_blocked',
      message: 'Write execution blocked at autonomy level A2 (dry-run only)',
    };
  }

  if (confidence < confidenceThreshold) {
    return {
      decision: 'deny',
      reasonCode: 'goal_confidence_too_low',
      message: `Goal confidence ${confidence.toFixed(2)} is below threshold ${confidenceThreshold.toFixed(2)}`,
    };
  }

  if (input.autoExecute && input.allowWrites) {
    if (policy.level === 'A3' && (risk === 'medium' || risk === 'high' || risk === 'critical')) {
      return {
        decision: 'require_approval',
        reasonCode: 'risk_requires_approval',
        message: `Risk ${risk} requires approval at autonomy level A3`,
      };
    }

    if (policy.level === 'A4' && (risk === 'high' || risk === 'critical')) {
      return {
        decision: 'require_approval',
        reasonCode: 'risk_requires_approval',
        message: `Risk ${risk} requires approval at autonomy level A4`,
      };
    }

    if (policy.level === 'A5' && risk === 'critical') {
      return {
        decision: 'require_approval',
        reasonCode: 'risk_requires_approval',
        message: 'Critical risk requires approval even at autonomy level A5',
      };
    }
  }

  return {
    decision: 'allow',
    reasonCode: 'allowed',
    message: 'allowed',
  };
}
