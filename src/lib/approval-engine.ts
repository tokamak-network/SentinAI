/**
 * Approval Engine
 * Centralized approval ticket lifecycle and validation.
 */

import { createHash, randomUUID } from 'crypto';
import { getStore } from '@/lib/redis-store';
import type { McpApprovalTicket, McpToolName } from '@/types/mcp';
import type { ApprovalValidationResult } from '@/types/policy';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function stripApprovalToken(params: unknown): unknown {
  if (!isObject(params)) return params;
  const copied: JsonObject = { ...params };
  delete copied.approvalToken;
  return copied;
}

export function hashApprovalParams(params: unknown): string {
  return createHash('sha256').update(stableSerialize(params)).digest('hex');
}

export function getApprovalTokenFromParams(params: unknown): string | undefined {
  if (!isObject(params)) return undefined;
  return typeof params.approvalToken === 'string' ? params.approvalToken : undefined;
}

export interface IssueApprovalTicketInput {
  toolName: McpToolName;
  toolParams: unknown;
  ttlSeconds: number;
  approvedBy?: string;
  reason?: string;
}

export interface IssuedApprovalTicketResult {
  approvalToken: string;
  toolName: McpToolName;
  expiresAt: string;
  ttlSeconds: number;
}

export async function issueApprovalTicket(
  input: IssueApprovalTicketInput
): Promise<IssuedApprovalTicketResult> {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + input.ttlSeconds * 1000);

  const ticket: McpApprovalTicket = {
    id: randomUUID(),
    toolName: input.toolName,
    paramsHash: hashApprovalParams(stripApprovalToken(input.toolParams)),
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    approvedBy: input.approvedBy,
    reason: input.reason,
  };

  await getStore().createMcpApprovalTicket(ticket);

  return {
    approvalToken: ticket.id,
    toolName: ticket.toolName,
    expiresAt: ticket.expiresAt,
    ttlSeconds: input.ttlSeconds,
  };
}

export async function validateAndConsumeApprovalTicket(
  token: string,
  toolName: McpToolName,
  toolParams: unknown
): Promise<ApprovalValidationResult> {
  const ticket = await getStore().consumeMcpApprovalTicket(token);
  if (!ticket) {
    return {
      ok: false,
      reasonCode: 'approval_token_missing_or_consumed',
      message: '승인 토큰이 없거나 이미 사용되었습니다.',
    };
  }

  if (ticket.toolName !== toolName) {
    return {
      ok: false,
      reasonCode: 'approval_tool_mismatch',
      message: '승인 토큰의 대상 도구가 일치하지 않습니다.',
    };
  }

  if (new Date(ticket.expiresAt).getTime() <= Date.now()) {
    return {
      ok: false,
      reasonCode: 'approval_token_expired',
      message: '승인 토큰이 만료되었습니다.',
    };
  }

  const expectedHash = hashApprovalParams(stripApprovalToken(toolParams));
  if (ticket.paramsHash !== expectedHash) {
    return {
      ok: false,
      reasonCode: 'approval_params_mismatch',
      message: '승인 토큰의 요청 파라미터가 일치하지 않습니다.',
    };
  }

  return { ok: true };
}

