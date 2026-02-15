/**
 * EOA Balance Monitor
 * Monitor batcher/proposer L1 ETH balance and trigger auto-refill.
 * Uses viem for L1 RPC calls and transaction signing.
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, parseGwei } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getChainPlugin } from '@/chains';
import { getActiveL1RpcUrl } from '@/lib/l1-rpc-failover';
import { getEOAAddressWithAutoDetect } from '@/lib/eoa-detector';
import { getCachedEOABalance, invalidateEOABalanceCache } from '@/lib/l1-rpc-cache';
import type {
  EOABalanceConfig,
  EOARole,
  BalanceLevel,
  BalanceCheckResult,
  RefillResult,
  EOABalanceStatus,
  RefillEvent,
} from '@/types/eoa-balance';

// ============================================================
// Configuration
// ============================================================

const DEFAULT_CONFIG: EOABalanceConfig = {
  warningThresholdEth: parseFloat(process.env.EOA_BALANCE_WARNING_ETH || '0.5'),
  criticalThresholdEth: parseFloat(process.env.EOA_BALANCE_CRITICAL_ETH || '0.1'),
  refillAmountEth: parseFloat(process.env.EOA_REFILL_AMOUNT_ETH || '1.0'),
  maxDailyRefillEth: parseFloat(process.env.EOA_REFILL_MAX_DAILY_ETH || '5.0'),
  cooldownMs: parseInt(process.env.EOA_REFILL_COOLDOWN_MIN || '10', 10) * 60 * 1000,
  gasGuardGwei: parseInt(process.env.EOA_GAS_GUARD_GWEI || '100', 10),
  minTreasuryBalanceEth: parseFloat(process.env.EOA_TREASURY_MIN_ETH || '1.0'),
};

const RPC_TIMEOUT_MS = 15_000;
const TX_RECEIPT_TIMEOUT_MS = 60_000;
const MAX_REFILL_EVENTS = 20;

// ============================================================
// State (globalThis singleton)
// ============================================================

interface EOAMonitorState {
  dailyRefillTotalEth: number;
  dailyResetDate: string;
  lastRefillTime: Record<string, number>;
  refillEvents: RefillEvent[];
}

const globalForEoa = globalThis as unknown as {
  __sentinai_eoa_monitor?: EOAMonitorState;
};

function getState(): EOAMonitorState {
  if (!globalForEoa.__sentinai_eoa_monitor) {
    globalForEoa.__sentinai_eoa_monitor = {
      dailyRefillTotalEth: 0,
      dailyResetDate: new Date().toDateString(),
      lastRefillTime: {},
      refillEvents: [],
    };
  }

  // Reset daily counter on date change
  const today = new Date().toDateString();
  if (globalForEoa.__sentinai_eoa_monitor.dailyResetDate !== today) {
    globalForEoa.__sentinai_eoa_monitor.dailyRefillTotalEth = 0;
    globalForEoa.__sentinai_eoa_monitor.dailyResetDate = today;
  }

  return globalForEoa.__sentinai_eoa_monitor;
}

// ============================================================
// Helpers
// ============================================================

// EOA refill is NOT gated by SCALING_SIMULATION_MODE.
// Refill safety is controlled by: TREASURY_PRIVATE_KEY, cooldown, daily limit, gas guard.

function getConfig(overrides?: Partial<EOABalanceConfig>): EOABalanceConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

function classifyBalance(balanceEth: number, config: EOABalanceConfig): BalanceLevel {
  if (balanceEth < config.criticalThresholdEth) return 'critical';
  if (balanceEth < config.warningThresholdEth) return 'warning';
  return 'normal';
}

/**
 * Get EOA address with automatic detection fallback
 * Priority: manual env var → L1 transaction analysis → null
 * Note: This is sync wrapper; actual detection happens in getAllBalanceStatus
 */
function getEOAAddress(role: EOARole): `0x${string}` | null {
  const plugin = getChainPlugin();
  const eoaConfig = plugin.eoaConfigs.find(c => c.role === role);
  const envKey = eoaConfig?.addressEnvVar || (role === 'batcher' ? 'BATCHER_EOA_ADDRESS' : 'PROPOSER_EOA_ADDRESS');
  const addr = process.env[envKey];
  if (addr && addr.startsWith('0x')) {
    return addr as `0x${string}`;
  }
  // Async detection handled in getAllBalanceStatus
  return null;
}

function getTreasuryKey(): `0x${string}` | null {
  const key = process.env.TREASURY_PRIVATE_KEY;
  if (!key || !key.startsWith('0x')) return null;
  return key as `0x${string}`;
}

function createL1Client(l1RpcUrl: string) {
  return createPublicClient({
    chain: getChainPlugin().l1Chain,
    transport: http(l1RpcUrl, { timeout: RPC_TIMEOUT_MS }),
  });
}

function pushRefillEvent(event: RefillEvent): void {
  const state = getState();
  state.refillEvents.push(event);
  if (state.refillEvents.length > MAX_REFILL_EVENTS) {
    state.refillEvents.shift();
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Check balance of a target EOA against thresholds
 */
export async function checkBalance(
  l1RpcUrl: string,
  targetAddress: `0x${string}`,
  role: EOARole,
  configOverrides?: Partial<EOABalanceConfig>
): Promise<BalanceCheckResult> {
  const config = getConfig(configOverrides);
  const client = createL1Client(l1RpcUrl);

  const balanceWei = await client.getBalance({ address: targetAddress });
  const balanceEth = parseFloat(formatEther(balanceWei));
  const level = classifyBalance(balanceEth, config);

  return {
    address: targetAddress,
    role,
    balanceEth,
    level,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get balance status for all monitored EOAs
 */
export async function getAllBalanceStatus(
  l1RpcUrl?: string
): Promise<EOABalanceStatus> {
  const rpcUrl = l1RpcUrl || getActiveL1RpcUrl();
  const config = getConfig();
  const state = getState();
  const treasuryKey = getTreasuryKey();

  let batcher: BalanceCheckResult | null = null;
  let proposer: BalanceCheckResult | null = null;
  let treasury: BalanceCheckResult | null = null;

  // Try environment variables first, then auto-detect if needed
  let batcherAddr = getEOAAddress('batcher');
  let proposerAddr = getEOAAddress('proposer');

  // If not in env, attempt auto-detection from L1 transactions
  if (!batcherAddr || !proposerAddr) {
    try {
      const detectedBatcher = !batcherAddr ? await getEOAAddressWithAutoDetect('batcher', rpcUrl) : null;
      const detectedProposer = !proposerAddr ? await getEOAAddressWithAutoDetect('proposer', rpcUrl) : null;

      if (detectedBatcher) {
        batcherAddr = detectedBatcher;
        console.log(`[EOA Monitor] Auto-detected batcher: ${batcherAddr}`);
      }
      if (detectedProposer) {
        proposerAddr = detectedProposer;
        console.log(`[EOA Monitor] Auto-detected proposer: ${proposerAddr}`);
      }
    } catch (err) {
      console.warn('[EOA Monitor] Auto-detection failed, continuing with available addresses:', err instanceof Error ? err.message : err);
    }
  }

  try {
    const client = createL1Client(rpcUrl);
    const promises: Promise<void>[] = [];

    if (batcherAddr) {
      promises.push(
        getCachedEOABalance(batcherAddr, () => client.getBalance({ address: batcherAddr })).then(bal => {
          const eth = parseFloat(formatEther(bal));
          batcher = {
            address: batcherAddr,
            role: 'batcher',
            balanceEth: eth,
            level: classifyBalance(eth, config),
            timestamp: new Date().toISOString(),
          };
        })
      );
    }

    if (proposerAddr) {
      promises.push(
        getCachedEOABalance(proposerAddr, () => client.getBalance({ address: proposerAddr })).then(bal => {
          const eth = parseFloat(formatEther(bal));
          proposer = {
            address: proposerAddr,
            role: 'proposer',
            balanceEth: eth,
            level: classifyBalance(eth, config),
            timestamp: new Date().toISOString(),
          };
        })
      );
    }

    if (treasuryKey) {
      const account = privateKeyToAccount(treasuryKey);
      promises.push(
        getCachedEOABalance(account.address, () => client.getBalance({ address: account.address })).then(bal => {
          const eth = parseFloat(formatEther(bal));
          treasury = {
            address: account.address,
            role: 'batcher', // Treasury doesn't have a role, reuse type
            balanceEth: eth,
            level: classifyBalance(eth, config),
            timestamp: new Date().toISOString(),
          };
        })
      );
    }

    await Promise.all(promises);
  } catch (error) {
    console.error('[EOA Monitor] Failed to fetch balances:', error instanceof Error ? error.message : error);
  }

  return {
    batcher,
    proposer,
    treasury,
    dailyRefillTotalEth: state.dailyRefillTotalEth,
    dailyRefillRemainingEth: Math.max(0, config.maxDailyRefillEth - state.dailyRefillTotalEth),
    signerAvailable: treasuryKey !== null,
  };
}

/**
 * Check if refill is allowed for a target EOA
 */
export async function canRefill(
  l1RpcUrl: string,
  targetAddress: `0x${string}`,
  configOverrides?: Partial<EOABalanceConfig>
): Promise<{ allowed: boolean; reason?: string }> {
  const config = getConfig(configOverrides);
  const state = getState();

  // 1. Check signer
  if (!getTreasuryKey()) {
    return { allowed: false, reason: 'no-signer' };
  }

  // 2. Cooldown
  const lastRefill = state.lastRefillTime[targetAddress];
  if (lastRefill && Date.now() - lastRefill < config.cooldownMs) {
    return { allowed: false, reason: 'cooldown' };
  }

  // 4. Daily limit
  if (state.dailyRefillTotalEth + config.refillAmountEth > config.maxDailyRefillEth) {
    return { allowed: false, reason: 'daily-limit' };
  }

  // 5. Treasury balance
  const treasuryKey = getTreasuryKey()!;
  const account = privateKeyToAccount(treasuryKey);
  const client = createL1Client(l1RpcUrl);

  try {
    const treasuryBalance = await client.getBalance({ address: account.address });
    const treasuryEth = parseFloat(formatEther(treasuryBalance));
    if (treasuryEth < config.minTreasuryBalanceEth) {
      return { allowed: false, reason: 'treasury-low' };
    }
  } catch {
    return { allowed: false, reason: 'treasury-low' };
  }

  // 6. Gas price
  try {
    const gasPrice = await client.getGasPrice();
    const gasPriceGwei = parseFloat(formatEther(gasPrice)) * 1e9;
    if (gasPriceGwei > config.gasGuardGwei) {
      return { allowed: false, reason: 'gas-high' };
    }
  } catch {
    // If gas price check fails, allow refill (don't block on RPC error)
  }

  return { allowed: true };
}

/**
 * Execute refill transaction from treasury to target EOA
 */
export async function refillEOA(
  l1RpcUrl: string,
  targetAddress: `0x${string}`,
  role: EOARole,
  configOverrides?: Partial<EOABalanceConfig>
): Promise<RefillResult> {
  const config = getConfig(configOverrides);
  const state = getState();

  // 1. Check signer
  const treasuryKey = getTreasuryKey();
  if (!treasuryKey) {
    return { success: false, reason: 'no-signer' };
  }

  // 2. Cooldown
  const lastRefill = state.lastRefillTime[targetAddress];
  if (lastRefill && Date.now() - lastRefill < config.cooldownMs) {
    return { success: false, reason: 'cooldown' };
  }

  // 4. Daily limit
  if (state.dailyRefillTotalEth + config.refillAmountEth > config.maxDailyRefillEth) {
    return { success: false, reason: 'daily-limit' };
  }

  const account = privateKeyToAccount(treasuryKey);
  const client = createL1Client(l1RpcUrl);

  // 5. Treasury balance check
  let treasuryBalance: bigint;
  try {
    treasuryBalance = await client.getBalance({ address: account.address });
    const treasuryEth = parseFloat(formatEther(treasuryBalance));
    if (treasuryEth < config.minTreasuryBalanceEth) {
      return { success: false, reason: 'treasury-low' };
    }
  } catch {
    return { success: false, reason: 'treasury-low' };
  }

  // 6. Gas price guard
  try {
    const gasPrice = await client.getGasPrice();
    if (gasPrice > parseGwei(String(config.gasGuardGwei))) {
      return { success: false, reason: 'gas-high' };
    }
  } catch {
    // Allow if gas check fails
  }

  // 7. Get previous balance
  let previousBalanceEth: number;
  try {
    const prevBal = await client.getBalance({ address: targetAddress });
    previousBalanceEth = parseFloat(formatEther(prevBal));
  } catch {
    previousBalanceEth = 0;
  }

  // 8. Send transaction
  const walletClient = createWalletClient({
    account,
    chain: getChainPlugin().l1Chain,
    transport: http(l1RpcUrl, { timeout: RPC_TIMEOUT_MS }),
  });

  try {
    const refillAmount = parseEther(String(config.refillAmountEth));

    const hash = await walletClient.sendTransaction({
      to: targetAddress,
      value: refillAmount,
    });

    console.log(`[EOA Monitor] Refill tx sent: ${hash} (${role} ${targetAddress}, ${config.refillAmountEth} ETH)`);

    // 9. Wait for receipt
    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: TX_RECEIPT_TIMEOUT_MS,
      confirmations: 1,
    });

    if (receipt.status === 'reverted') {
      console.error(`[EOA Monitor] Refill tx reverted: ${hash}`);
      return { success: false, reason: 'tx-reverted', txHash: hash };
    }

    // Invalidate target EOA balance cache after successful refill
    invalidateEOABalanceCache(targetAddress);

    // 10. Verify new balance
    let newBalanceEth: number;
    try {
      const newBal = await client.getBalance({ address: targetAddress });
      newBalanceEth = parseFloat(formatEther(newBal));
    } catch {
      newBalanceEth = previousBalanceEth + config.refillAmountEth;
    }

    // 11. Update state
    state.lastRefillTime[targetAddress] = Date.now();
    state.dailyRefillTotalEth += config.refillAmountEth;

    const gasUsed = receipt.gasUsed ? Number(receipt.gasUsed) : undefined;

    pushRefillEvent({
      timestamp: new Date().toISOString(),
      role,
      targetAddress,
      amountEth: config.refillAmountEth,
      txHash: hash,
      previousBalanceEth,
      newBalanceEth,
      simulated: false,
    });

    console.log(`[EOA Monitor] Refill confirmed: ${role} ${previousBalanceEth.toFixed(4)} → ${newBalanceEth.toFixed(4)} ETH (tx: ${hash})`);

    return {
      success: true,
      txHash: hash,
      previousBalanceEth,
      newBalanceEth,
      refillAmountEth: config.refillAmountEth,
      gasUsed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[EOA Monitor] Refill failed: ${message}`);
    return { success: false, reason: 'tx-timeout' };
  }
}

// ============================================================
// State Accessors
// ============================================================

/** Get refill event history */
export function getRefillEvents(): RefillEvent[] {
  return [...getState().refillEvents];
}

/** Reset daily counter (for testing) */
export function resetDailyCounter(): void {
  const state = getState();
  state.dailyRefillTotalEth = 0;
  state.dailyResetDate = new Date().toDateString();
}

/** Reset all state (for testing) */
export function resetEOAMonitorState(): void {
  globalForEoa.__sentinai_eoa_monitor = undefined;
}

/** Get current config (for testing/API) */
export function getEOAConfig(): EOABalanceConfig {
  return getConfig();
}

/** Classify balance level (exported for use by anomaly-detector) */
export { classifyBalance };
