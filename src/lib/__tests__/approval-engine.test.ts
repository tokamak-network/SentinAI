import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getApprovalTokenFromParams,
  hashApprovalParams,
  issueApprovalTicket,
  stripApprovalToken,
  validateAndConsumeApprovalTicket,
} from '@/lib/approval-engine';
import type { McpApprovalTicket } from '@/types/mcp';

const hoisted = vi.hoisted(() => ({
  ticketMap: new Map<string, McpApprovalTicket>(),
}));

vi.mock('@/lib/redis-store', () => ({
  getStore: vi.fn(() => ({
    createMcpApprovalTicket: async (ticket: McpApprovalTicket) => {
      hoisted.ticketMap.set(ticket.id, ticket);
    },
    getMcpApprovalTicket: async (ticketId: string) => hoisted.ticketMap.get(ticketId) || null,
    consumeMcpApprovalTicket: async (ticketId: string) => {
      const ticket = hoisted.ticketMap.get(ticketId) || null;
      if (ticket) hoisted.ticketMap.delete(ticketId);
      return ticket;
    },
  })),
}));

describe('approval-engine', () => {
  beforeEach(() => {
    hoisted.ticketMap.clear();
    vi.clearAllMocks();
  });

  it('should remove approvalToken from params', () => {
    const stripped = stripApprovalToken({
      targetVcpu: 4,
      approvalToken: 'abc',
    }) as Record<string, unknown>;

    expect(stripped.targetVcpu).toBe(4);
    expect(stripped.approvalToken).toBeUndefined();
  });

  it('should generate stable hash regardless of key order', () => {
    const left = hashApprovalParams({ a: 1, b: 2 });
    const right = hashApprovalParams({ b: 2, a: 1 });
    expect(left).toBe(right);
  });

  it('should extract approval token from params', () => {
    expect(getApprovalTokenFromParams({ approvalToken: 'token-1' })).toBe('token-1');
    expect(getApprovalTokenFromParams({})).toBeUndefined();
  });

  it('should issue and validate approval ticket', async () => {
    const issued = await issueApprovalTicket({
      toolName: 'scale_component',
      toolParams: { targetVcpu: 4 },
      ttlSeconds: 300,
      approvedBy: 'tester',
    });

    const result = await validateAndConsumeApprovalTicket(
      issued.approvalToken,
      'scale_component',
      { targetVcpu: 4 }
    );

    expect(result.ok).toBe(true);
  });

  it('should reject mismatched tool name', async () => {
    const issued = await issueApprovalTicket({
      toolName: 'scale_component',
      toolParams: { targetVcpu: 4 },
      ttlSeconds: 300,
    });

    const result = await validateAndConsumeApprovalTicket(
      issued.approvalToken,
      'restart_component',
      { target: 'op-geth' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe('approval_tool_mismatch');
    }
  });

  it('should reject mismatched params hash', async () => {
    const issued = await issueApprovalTicket({
      toolName: 'scale_component',
      toolParams: { targetVcpu: 4 },
      ttlSeconds: 300,
    });

    const result = await validateAndConsumeApprovalTicket(
      issued.approvalToken,
      'scale_component',
      { targetVcpu: 8 }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe('approval_params_mismatch');
    }
  });

  it('should reject expired ticket', async () => {
    const issued = await issueApprovalTicket({
      toolName: 'scale_component',
      toolParams: { targetVcpu: 4 },
      ttlSeconds: 300,
    });

    const storedTicket = [...hoisted.ticketMap.values()].find((item) => item.id === issued.approvalToken);
    if (!storedTicket) {
      throw new Error('Ticket was not stored');
    }
    storedTicket.expiresAt = new Date(Date.now() - 1000).toISOString();
    hoisted.ticketMap.set(storedTicket.id, storedTicket);

    const result = await validateAndConsumeApprovalTicket(
      issued.approvalToken,
      'scale_component',
      { targetVcpu: 4 }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe('approval_token_expired');
    }
  });
});

