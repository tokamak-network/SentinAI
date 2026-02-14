/**
 * Action Executor
 * Execute individual remediation actions by wrapping existing K8s modules
 */

import type { RemediationAction, ActionResult, RCAComponent } from '@/types/remediation';
import type { ScalingConfig } from '@/types/scaling';
import { scaleOpGeth } from '@/lib/k8s-scaler';
import { zeroDowntimeScale } from '@/lib/zero-downtime-scaler';
import { runK8sCommand } from '@/lib/k8s-config';
import { getActiveL1RpcUrl, healthCheckEndpoint, getL1FailoverState, maskUrl } from '@/lib/l1-rpc-failover';
import { checkBalance, refillEOA, getAllBalanceStatus } from '@/lib/eoa-balance-monitor';
import type { EOARole } from '@/types/eoa-balance';
import { DEFAULT_SCALING_CONFIG } from '@/types/scaling';
import { getChainPlugin } from '@/chains';

// ============================================================
// Configuration
// ============================================================

const MAX_AUTO_SCALE_VCPU = parseInt(process.env.REMEDIATION_MAX_VCPU || '4', 10);

// ============================================================
// Component to Pod Name Mapping
// ============================================================

function getPodName(component: RCAComponent, config: ScalingConfig): string {
  const { statefulSetName } = config;
  const plugin = getChainPlugin();

  // Primary execution client uses the config's statefulSetName
  if (component === plugin.primaryExecutionClient) {
    return `${statefulSetName}-0`;
  }

  // Other components: derive from statefulSetName prefix + plugin k8s config
  const k8sConfig = plugin.k8sComponents.find(c => c.component === component);
  if (k8sConfig) {
    // Extract prefix from statefulSetName (e.g. 'op-geth' → prefix not needed, use env-based naming)
    const prefix = process.env.K8S_APP_PREFIX || 'op';
    // Build pod name: prefix-statefulSetSuffix-0
    return `${prefix}-${k8sConfig.statefulSetSuffix}-0`;
  }

  return `${statefulSetName}-0`;
}

// ============================================================
// Action Executors
// ============================================================

/**
 * Collect logs from target component
 */
async function executeCollectLogs(
  action: RemediationAction,
  config: ScalingConfig
): Promise<string> {
  const podName = getPodName(action.target || 'op-geth', config);
  const { namespace } = config;

  try {
    const { stdout } = await runK8sCommand(
      `logs ${podName} -n ${namespace} --tail=100`,
      { timeout: 30000 }
    );
    return `Collected ${stdout.split('\n').length} log lines from ${podName}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Log collection failed: ${message}`);
  }
}

/**
 * Health check: Pod status + RPC responsiveness
 */
async function executeHealthCheck(
  action: RemediationAction,
  config: ScalingConfig
): Promise<string> {
  const podName = getPodName(action.target || 'op-geth', config);
  const { namespace } = config;

  try {
    // Check Pod Ready status
    const { stdout: readyStatus } = await runK8sCommand(
      `get pod ${podName} -n ${namespace} -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'`,
      { timeout: 10000 }
    );

    const isReady = readyStatus.replace(/'/g, '').trim() === 'True';

    if (!isReady) {
      return `Health check: ${podName} is NOT ready`;
    }

    // RPC check (op-geth only)
    if (action.target === 'op-geth') {
      try {
        const { stdout: rpcResponse } = await runK8sCommand(
          `exec ${podName} -n ${namespace} -- wget -qO- --timeout=5 http://localhost:8545 --post-data='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`,
          { timeout: 15000 }
        );
        const parsed = JSON.parse(rpcResponse);
        const blockNumber = parseInt(parsed.result, 16);
        return `Health check: ${podName} is Ready, RPC responsive (block #${blockNumber})`;
      } catch {
        return `Health check: ${podName} is Ready, but RPC not responsive`;
      }
    }

    return `Health check: ${podName} is Ready`;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Health check failed: ${message}`);
  }
}

/**
 * Check L1 RPC connection
 */
async function executeCheckL1Connection(): Promise<string> {
  const activeUrl = getActiveL1RpcUrl();
  const state = getL1FailoverState();
  const isHealthy = await healthCheckEndpoint(activeUrl);

  if (isHealthy) {
    return `L1 connection check: OK (${maskUrl(activeUrl)}, ${state.endpoints.length} endpoints configured)`;
  }
  return `L1 connection check: FAILED (${maskUrl(activeUrl)} unreachable, ${state.endpoints.length} endpoints total)`;
}

/**
 * Describe Pod detailed status
 */
async function executeDescribePod(
  action: RemediationAction,
  config: ScalingConfig
): Promise<string> {
  const podName = getPodName(action.target || 'op-geth', config);
  const { namespace } = config;

  try {
    const { stdout } = await runK8sCommand(
      `describe pod ${podName} -n ${namespace}`,
      { timeout: 20000 }
    );
    return `Pod description:\n${stdout.substring(0, 500)}...`; // Truncate for brevity
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Describe pod failed: ${message}`);
  }
}

/**
 * Restart Pod (delete → auto-recreate by StatefulSet)
 */
async function executeRestartPod(
  action: RemediationAction,
  config: ScalingConfig
): Promise<string> {
  const podName = getPodName(action.target || 'op-geth', config);
  const { namespace } = config;

  try {
    await runK8sCommand(
      `delete pod ${podName} -n ${namespace} --grace-period=60`,
      { timeout: 90000 }
    );

    // Wait for recreation
    await new Promise(resolve => setTimeout(resolve, 5000));

    return `Restarted ${podName} (deleted, StatefulSet recreating)`;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Pod restart failed: ${message}`);
  }
}

/**
 * Scale up vCPU/Memory
 */
async function executeScaleUp(
  action: RemediationAction,
  config: ScalingConfig
): Promise<string> {
  const currentVcpu = await getCurrentVcpu(config);
  let targetVcpu = currentVcpu;

  // Determine target vCPU
  if (action.params?.targetVcpu === 'next_tier') {
    if (currentVcpu < 2) targetVcpu = 2;
    else if (currentVcpu < 4) targetVcpu = 4;
    else targetVcpu = currentVcpu; // Already at max
  } else if (typeof action.params?.targetVcpu === 'number') {
    targetVcpu = action.params.targetVcpu as number;
  }

  // Enforce max auto-scale limit
  targetVcpu = Math.min(targetVcpu, MAX_AUTO_SCALE_VCPU);

  if (targetVcpu === currentVcpu) {
    return `Scale-up skipped: already at ${currentVcpu} vCPU (max auto-scale: ${MAX_AUTO_SCALE_VCPU})`;
  }

  const targetMemoryGiB = targetVcpu * 2; // vCPU * 2

  try {
    const result = await scaleOpGeth(targetVcpu, targetMemoryGiB, config);

    if (result.success) {
      return `Scaled up from ${result.previousVcpu} to ${result.currentVcpu} vCPU`;
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Scale-up failed: ${message}`);
  }
}

/**
 * Scale down vCPU/Memory
 */
async function executeScaleDown(
  action: RemediationAction,
  config: ScalingConfig
): Promise<string> {
  const currentVcpu = await getCurrentVcpu(config);
  let targetVcpu = currentVcpu;

  // Determine target vCPU
  if (action.params?.targetVcpu === 'previous_tier') {
    if (currentVcpu > 2) targetVcpu = 2;
    else if (currentVcpu > 1) targetVcpu = 1;
    else targetVcpu = currentVcpu; // Already at min
  } else if (typeof action.params?.targetVcpu === 'number') {
    targetVcpu = action.params.targetVcpu as number;
  }

  if (targetVcpu === currentVcpu) {
    return `Scale-down skipped: already at ${currentVcpu} vCPU`;
  }

  const targetMemoryGiB = targetVcpu * 2;

  try {
    const result = await scaleOpGeth(targetVcpu, targetMemoryGiB, config);

    if (result.success) {
      return `Scaled down from ${result.previousVcpu} to ${result.currentVcpu} vCPU`;
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Scale-down failed: ${message}`);
  }
}

/**
 * Zero-downtime swap (parallel pod swap)
 */
async function executeZeroDowntimeSwap(
  action: RemediationAction,
  config: ScalingConfig
): Promise<string> {
  const currentVcpu = await getCurrentVcpu(config);
  let targetVcpu = currentVcpu;

  // Determine target (same logic as scale-up)
  if (action.params?.targetVcpu === 'next_tier') {
    if (currentVcpu < 2) targetVcpu = 2;
    else if (currentVcpu < 4) targetVcpu = 4;
    else targetVcpu = currentVcpu;
  } else if (typeof action.params?.targetVcpu === 'number') {
    targetVcpu = action.params.targetVcpu as number;
  }

  targetVcpu = Math.min(targetVcpu, MAX_AUTO_SCALE_VCPU);

  if (targetVcpu === currentVcpu) {
    return `Zero-downtime swap skipped: already at ${currentVcpu} vCPU`;
  }

  const targetMemoryGiB = targetVcpu * 2;

  try {
    const result = await zeroDowntimeScale(targetVcpu, targetMemoryGiB, config);

    if (result.success) {
      return `Zero-downtime swap: ${currentVcpu} → ${targetVcpu} vCPU (${result.totalDurationMs}ms)`;
    } else {
      throw new Error(result.error || 'Unknown error');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Zero-downtime swap failed: ${message}`);
  }
}

// ============================================================
// Helper: Get Current vCPU
// ============================================================

async function getCurrentVcpu(config: ScalingConfig): Promise<number> {
  const { namespace, statefulSetName, containerIndex } = config;

  try {
    const { stdout } = await runK8sCommand(
      `get statefulset ${statefulSetName} -n ${namespace} -o jsonpath='{.spec.template.spec.containers[${containerIndex}].resources.requests.cpu}'`,
      { timeout: 10000 }
    );

    const cpuStr = stdout.replace(/'/g, '').trim();
    if (cpuStr.includes('m')) {
      return parseFloat(cpuStr) / 1000;
    }
    return parseFloat(cpuStr) || 1;
  } catch {
    return 1; // Fallback
  }
}

// ============================================================
// EOA Balance Actions
// ============================================================

/**
 * Check treasury wallet balance
 */
async function executeCheckTreasuryBalance(): Promise<string> {
  const status = await getAllBalanceStatus();
  if (!status.signerAvailable) {
    return 'Treasury check: No signer configured (notification-only mode)';
  }
  if (!status.treasury) {
    return 'Treasury check: Unable to fetch treasury balance';
  }
  const { balanceEth, level } = status.treasury;
  return `Treasury balance: ${balanceEth.toFixed(4)} ETH (${level}), daily remaining: ${status.dailyRefillRemainingEth.toFixed(2)} ETH`;
}

/**
 * Check L1 gas price
 */
async function executeCheckL1GasPrice(): Promise<string> {
  const { createPublicClient: createClient, http: httpTransport, formatGwei } = await import('viem');
  const plugin = getChainPlugin();
  const l1RpcUrl = getActiveL1RpcUrl();
  const client = createClient({ chain: plugin.l1Chain, transport: httpTransport(l1RpcUrl, { timeout: 15000 }) });

  try {
    const gasPrice = await client.getGasPrice();
    const gasPriceGwei = formatGwei(gasPrice);
    const guardGwei = parseInt(process.env.EOA_GAS_GUARD_GWEI || '100', 10);
    const isOk = parseFloat(gasPriceGwei) <= guardGwei;
    return `L1 gas price: ${gasPriceGwei} gwei (guard: ${guardGwei} gwei) — ${isOk ? 'OK' : 'TOO HIGH'}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Gas price check failed: ${message}`);
  }
}

/**
 * Execute EOA refill transaction
 */
async function executeRefillEOA(action: RemediationAction): Promise<string> {
  const role = (action.params?.role as EOARole) || 'batcher';
  const plugin = getChainPlugin();
  const eoaConfig = plugin.eoaConfigs.find(c => c.role === role);
  const targetAddr = eoaConfig
    ? process.env[eoaConfig.addressEnvVar]
    : (role === 'batcher' ? process.env.BATCHER_EOA_ADDRESS : process.env.PROPOSER_EOA_ADDRESS);

  if (!targetAddr) {
    throw new Error(`${role} EOA address not configured`);
  }

  const l1RpcUrl = getActiveL1RpcUrl();
  const result = await refillEOA(l1RpcUrl, targetAddr as `0x${string}`, role);

  if (result.success) {
    return `Refilled ${role} EOA: ${result.previousBalanceEth?.toFixed(4)} → ${result.newBalanceEth?.toFixed(4)} ETH (tx: ${result.txHash})`;
  }
  throw new Error(`EOA refill denied: ${result.reason}`);
}

/**
 * Verify target EOA balance was restored above critical threshold
 */
async function executeVerifyBalanceRestored(action: RemediationAction): Promise<string> {
  const role = (action.params?.role as EOARole) || 'batcher';
  const targetAddr = role === 'batcher'
    ? process.env.BATCHER_EOA_ADDRESS
    : process.env.PROPOSER_EOA_ADDRESS;

  if (!targetAddr) {
    throw new Error(`${role} EOA address not configured`);
  }

  const l1RpcUrl = getActiveL1RpcUrl();
  const result = await checkBalance(l1RpcUrl, targetAddr as `0x${string}`, role);

  if (result.level === 'normal' || result.level === 'warning') {
    return `Balance restored: ${role} EOA = ${result.balanceEth.toFixed(4)} ETH (${result.level})`;
  }
  throw new Error(`Balance still ${result.level}: ${role} EOA = ${result.balanceEth.toFixed(4)} ETH`);
}

// ============================================================
// Main Executor
// ============================================================

/**
 * Execute a single remediation action
 */
export async function executeAction(
  action: RemediationAction,
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): Promise<ActionResult> {
  const result: ActionResult = {
    action,
    status: 'running',
    startedAt: new Date().toISOString(),
  };

  try {
    let output: string;

    switch (action.type) {
      case 'collect_logs':
        output = await executeCollectLogs(action, config);
        break;

      case 'health_check':
        output = await executeHealthCheck(action, config);
        break;

      case 'check_l1_connection':
        output = await executeCheckL1Connection();
        break;

      case 'describe_pod':
        output = await executeDescribePod(action, config);
        break;

      case 'restart_pod':
        output = await executeRestartPod(action, config);
        break;

      case 'scale_up':
        output = await executeScaleUp(action, config);
        break;

      case 'scale_down':
        output = await executeScaleDown(action, config);
        break;

      case 'zero_downtime_swap':
        output = await executeZeroDowntimeSwap(action, config);
        break;

      case 'check_treasury_balance':
        output = await executeCheckTreasuryBalance();
        break;

      case 'check_l1_gas_price':
        output = await executeCheckL1GasPrice();
        break;

      case 'refill_eoa':
        output = await executeRefillEOA(action);
        break;

      case 'verify_balance_restored':
        output = await executeVerifyBalanceRestored(action);
        break;

      case 'escalate_operator':
        output = `Escalation required: ${action.params?.message || 'EOA balance critically low'}`;
        break;

      case 'config_change':
      case 'rollback_deployment':
      case 'force_restart_all':
        // Manual actions should never reach here — skipped in engine
        output = 'Manual action — requires operator approval';
        result.status = 'skipped';
        break;

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }

    result.output = output;
    result.status = 'success';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    result.error = message;
    result.status = 'failed';
  }

  result.completedAt = new Date().toISOString();
  return result;
}
