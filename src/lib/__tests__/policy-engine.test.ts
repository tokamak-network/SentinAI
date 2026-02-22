import { describe, expect, it } from 'vitest';
import {
  evaluateGoalExecutionPolicy,
  evaluateMcpApprovalIssuePolicy,
  evaluateMcpToolPolicy,
} from '@/lib/policy-engine';

describe('policy-engine', () => {
  it('should allow read MCP tool with valid api key', () => {
    const result = evaluateMcpToolPolicy({
      toolName: 'get_metrics',
      writeOperation: false,
      authMode: 'api-key',
      approvalRequired: true,
      apiKeyProvided: 'k1',
      configuredApiKey: 'k1',
      readOnlyMode: false,
      allowScalerWriteInReadOnly: false,
    });

    expect(result.decision).toBe('allow');
    expect(result.reasonCode).toBe('allowed');
  });

  it('should deny when api key is invalid', () => {
    const result = evaluateMcpToolPolicy({
      toolName: 'get_metrics',
      writeOperation: false,
      authMode: 'api-key',
      approvalRequired: true,
      apiKeyProvided: 'k2',
      configuredApiKey: 'k1',
      readOnlyMode: false,
      allowScalerWriteInReadOnly: false,
    });

    expect(result.decision).toBe('deny');
    expect(result.reasonCode).toBe('api_key_invalid');
  });

  it('should deny write tool in read-only mode', () => {
    const result = evaluateMcpToolPolicy({
      toolName: 'restart_component',
      writeOperation: true,
      authMode: 'api-key',
      approvalRequired: true,
      apiKeyProvided: 'k1',
      configuredApiKey: 'k1',
      readOnlyMode: true,
      allowScalerWriteInReadOnly: false,
    });

    expect(result.decision).toBe('deny');
    expect(result.reasonCode).toBe('read_only_write_blocked');
  });

  it('should allow scaler write in read-only mode when override is enabled', () => {
    const result = evaluateMcpToolPolicy({
      toolName: 'scale_component',
      writeOperation: true,
      authMode: 'api-key',
      approvalRequired: false,
      apiKeyProvided: 'k1',
      configuredApiKey: 'k1',
      readOnlyMode: true,
      allowScalerWriteInReadOnly: true,
    });

    expect(result.decision).toBe('allow');
    expect(result.reasonCode).toBe('allowed');
  });

  it('should require approval for write operation by policy', () => {
    const result = evaluateMcpToolPolicy({
      toolName: 'scale_component',
      writeOperation: true,
      authMode: 'api-key',
      approvalRequired: true,
      apiKeyProvided: 'k1',
      configuredApiKey: 'k1',
      readOnlyMode: false,
      allowScalerWriteInReadOnly: false,
    });

    expect(result.decision).toBe('require_approval');
    expect(result.reasonCode).toBe('approval_required');
  });

  it('should deny approval ticket issuance with invalid api key', () => {
    const result = evaluateMcpApprovalIssuePolicy({
      apiKeyProvided: 'wrong',
      configuredApiKey: 'correct',
    });

    expect(result.decision).toBe('deny');
    expect(result.reasonCode).toBe('api_key_invalid');
  });

  it('should deny goals write execution in read-only mode', () => {
    const result = evaluateGoalExecutionPolicy({
      autoExecute: true,
      allowWrites: true,
      readOnlyMode: true,
    });

    expect(result.decision).toBe('deny');
    expect(result.reasonCode).toBe('read_only_write_blocked');
  });
});

