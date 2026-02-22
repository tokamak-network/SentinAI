/**
 * Operation Verifier
 * Post-condition checks for write operations.
 */

import { getCurrentVcpu } from '@/lib/k8s-scaler';
import { executeAction } from '@/lib/action-executor';
import { getActiveL1RpcUrl, healthCheckEndpoint, maskUrl } from '@/lib/l1-rpc-failover';
import { DEFAULT_SCALING_CONFIG } from '@/types/scaling';
import type {
  OperationVerificationInput,
  OperationVerificationResult,
} from '@/types/operation-control';
import type { RemediationAction } from '@/types/remediation';

function nowIso(): string {
  return new Date().toISOString();
}

function buildVerification(
  expected: string,
  observed: string,
  passed: boolean,
  details?: string
): OperationVerificationResult {
  return {
    expected,
    observed,
    passed,
    details,
    verifiedAt: nowIso(),
  };
}

function toStringValue(value: unknown, fallback: string = 'n/a'): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return fallback;
}

function isHealthyOutput(output: string | undefined): boolean {
  if (!output) return false;
  const normalized = output.toLowerCase();
  if (normalized.includes('not') || normalized.includes('fail')) return false;
  return (
    normalized.includes('ready') ||
    normalized.includes('running') ||
    normalized.includes('ok') ||
    normalized.includes('success') ||
    normalized.includes('restart')
  );
}

async function verifyScale(input: OperationVerificationInput): Promise<OperationVerificationResult> {
  const targetVcpu = Number(input.expected.targetVcpu);
  if (!Number.isFinite(targetVcpu)) {
    return buildVerification('valid targetVcpu', 'invalid targetVcpu', false, 'missing targetVcpu in expected');
  }

  const actualVcpu = await getCurrentVcpu();
  const passed = actualVcpu === targetVcpu;
  return buildVerification(
    `${targetVcpu} vCPU`,
    `${actualVcpu} vCPU`,
    passed,
    passed ? 'target vCPU applied' : 'observed vCPU does not match target'
  );
}

async function verifyRestart(input: OperationVerificationInput): Promise<OperationVerificationResult> {
  const target = toStringValue(input.expected.target, 'op-geth');
  const healthAction: RemediationAction = {
    type: 'health_check',
    safetyLevel: 'safe',
    target,
  };

  const healthResult = await executeAction(healthAction, DEFAULT_SCALING_CONFIG);
  const output = healthResult.output || healthResult.error || 'health check unavailable';
  const passed = healthResult.status === 'success' && isHealthyOutput(output);

  return buildVerification(
    `${target} healthy`,
    output,
    passed,
    passed ? 'health check passed after restart' : 'health check failed after restart'
  );
}

async function verifySwitchL1Rpc(input: OperationVerificationInput): Promise<OperationVerificationResult> {
  const targetUrl = toStringValue(input.expected.targetUrl, '');
  const activeUrl = getActiveL1RpcUrl();
  const health = await healthCheckEndpoint(activeUrl);

  const targetMasked = targetUrl ? maskUrl(targetUrl) : 'next-healthy-endpoint';
  const activeMasked = maskUrl(activeUrl);
  const targetMatched = targetUrl ? activeUrl === targetUrl : true;
  const passed = targetMatched && health;

  return buildVerification(
    `${targetMasked} (healthy)`,
    `${activeMasked} (${health ? 'healthy' : 'unhealthy'})`,
    passed,
    passed ? 'L1 RPC switch verified' : 'active L1 RPC does not match target or is unhealthy'
  );
}

function verifyProxydBackendUpdate(input: OperationVerificationInput): OperationVerificationResult {
  const expectedBackend = toStringValue(input.expected.backendName);
  const expectedUrl = toStringValue(input.expected.newRpcUrl);
  const observedBackend = toStringValue(input.observed.backendName);
  const observedUrl = toStringValue(input.observed.newRpcUrl);
  const updateSuccess = input.observed.success === true;

  const passed = updateSuccess && expectedBackend === observedBackend && expectedUrl === observedUrl;
  return buildVerification(
    `${expectedBackend} -> ${maskUrl(expectedUrl)}`,
    `${observedBackend} -> ${maskUrl(observedUrl)} (success=${updateSuccess})`,
    passed,
    passed ? 'proxyd backend update verified' : 'proxyd backend update mismatch'
  );
}

export async function verifyOperationOutcome(
  input: OperationVerificationInput
): Promise<OperationVerificationResult> {
  if (input.dryRun) {
    return buildVerification(
      'dry-run execution',
      'dry-run execution',
      true,
      'verification skipped because operation was dry-run'
    );
  }

  if (
    input.actionType === 'scale_component' ||
    input.actionType === 'goal_scale_execution' ||
    input.actionType === 'agent_scaling'
  ) {
    return verifyScale(input);
  }

  if (
    input.actionType === 'restart_component' ||
    input.actionType === 'restart_batcher' ||
    input.actionType === 'restart_proposer' ||
    input.actionType === 'goal_restart_execution'
  ) {
    return verifyRestart(input);
  }

  if (input.actionType === 'switch_l1_rpc') {
    return verifySwitchL1Rpc(input);
  }

  if (input.actionType === 'update_proxyd_backend') {
    return verifyProxydBackendUpdate(input);
  }

  return buildVerification('no-op', 'no-op', true, 'no verifier rule for action');
}
