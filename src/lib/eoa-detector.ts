/**
 * EOA Detector — Auto-detect batcher/proposer EOAs from L1 transaction analysis
 *
 * Latest Optimism Architecture (OP Stack):
 * - Batcher: Submits transaction batches to BatcherInbox (data availability)
 * - Proposer: Submits L2 output roots to L2OutputOracle (state roots)
 *
 * This module analyzes L1 transactions to identify these EOAs dynamically
 * without requiring manual configuration.
 */

import { createPublicClient, http, getAddress, isAddress } from 'viem';
import { getActiveL1RpcUrl } from '@/lib/l1-rpc-failover';
import type { EOARole } from '@/types/eoa-balance';

// ============================================================
// Optimism Contract Addresses (OP Stack)
// ============================================================

interface OptimismAddresses {
  batcherInbox: `0x${string}`;
  l2OutputOracle: `0x${string}`;
  chainName: string;
}

/**
 * Known Optimism contract addresses by network
 * Source: https://docs.optimism.io/
 */
const OPTIMISM_ADDRESSES: Record<string, OptimismAddresses> = {
  // Mainnet
  'optimism-mainnet': {
    batcherInbox: '0xFF00000000000000000000000000000000000054',
    l2OutputOracle: '0xdfe97868233d1b6f5e00d8d181f0302b92b77018',
    chainName: 'Optimism Mainnet',
  },
  // Sepolia Testnet
  'optimism-sepolia': {
    batcherInbox: '0xFF00000000000000000000000000000000000054',
    l2OutputOracle: '0x90e9c4f8a994a250f6aefd61cafb4f2e895ea02b',
    chainName: 'Optimism Sepolia',
  },
  // Base Mainnet
  'base-mainnet': {
    batcherInbox: '0xFF00000000000000000000000000000000000054',
    l2OutputOracle: '0x56315b90c40730925ec5485cf004d835260518a7',
    chainName: 'Base Mainnet',
  },
  // Base Sepolia
  'base-sepolia': {
    batcherInbox: '0xFF00000000000000000000000000000000000054',
    l2OutputOracle: '0x84457ca8fc6b7ae495687e9ebfa0250990f50efa',
    chainName: 'Base Sepolia',
  },
};

// ============================================================
// Type Definitions
// ============================================================

export interface DetectionResult {
  batcherEOA?: `0x${string}`;
  proposerEOA?: `0x${string}`;
  source: 'manual-env' | 'l1-transaction-analysis' | 'not-detected';
  confidence: 'high' | 'medium' | 'low';
  chainName?: string;
  lastBlockAnalyzed?: bigint;
  message?: string;
}

// ============================================================
// Detection Logic
// ============================================================

/**
 * Get Optimism contract addresses for the given L1 RPC URL
 * Attempts to detect network by analyzing L1 and falling back to defaults
 */
async function getOptimismAddresses(
  l1RpcUrl: string,
  networkKey?: string
): Promise<OptimismAddresses | null> {
  // If network key provided, use it directly
  if (networkKey && OPTIMISM_ADDRESSES[networkKey]) {
    return OPTIMISM_ADDRESSES[networkKey];
  }

  // Try to detect from common L1 networks
  try {
    const client = createPublicClient({ transport: http(l1RpcUrl, { timeout: 5000 }) });
    const chainId = await client.getChainId();

    // Sepolia (chain ID 11155111)
    if (chainId === 11155111) {
      return OPTIMISM_ADDRESSES['optimism-sepolia'];
    }
    // Ethereum Mainnet (chain ID 1)
    if (chainId === 1) {
      return OPTIMISM_ADDRESSES['optimism-mainnet'];
    }
  } catch {
    // If detection fails, continue
  }

  // Default to Sepolia (most common testnet)
  return OPTIMISM_ADDRESSES['optimism-sepolia'];
}

/**
 * Analyze L1 transactions to detect batcher EOA
 *
 * The batcher continuously submits transaction batches to BatcherInbox.
 * We look for transactions to the BatcherInbox address with calldata prefix 0x00
 * (indicating a "frame" of transactions).
 */
async function detectBatcherEOA(
  l1RpcUrl: string,
  batcherInboxAddr: `0x${string}`,
  blockRange: number = 1000
): Promise<`0x${string}` | null> {
  const client = createPublicClient({
    transport: http(l1RpcUrl, { timeout: 15000 }),
  });

  try {
    const latestBlock = await client.getBlockNumber();
    const startBlock = latestBlock - BigInt(blockRange);

    console.log(`[EOA Detector] Scanning L1 blocks ${startBlock} to ${latestBlock} for batcher transactions...`);

    // Get recent blocks with transactions
    for (let i = 0n; i < BigInt(blockRange); i++) {
      const blockNum = startBlock + i;

      try {
        const block = await client.getBlock({
          blockNumber: blockNum,
          includeTransactions: true,
        });

        if (!block.transactions) continue;

        // Look for transactions to BatcherInbox
        for (const tx of block.transactions) {
          if (typeof tx === 'object' && tx.to) {
            if (tx.to.toLowerCase() === batcherInboxAddr.toLowerCase()) {
              // Batcher transactions typically have:
              // - data starting with 0x00 (frame opcode)
              // - significant calldata (> 100 bytes)
              if (tx.input && tx.input.startsWith('0x00') && tx.input.length > 200) {
                console.log(
                  `[EOA Detector] Found batcher transaction at block ${blockNum}: ${tx.from}`
                );
                return tx.from as `0x${string}`;
              }
            }
          }
        }
      } catch (err) {
        // Continue on individual block failures
        continue;
      }
    }

    console.log('[EOA Detector] No batcher transactions found in range');
    return null;
  } catch (error) {
    console.error('[EOA Detector] Failed to detect batcher EOA:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Analyze L1 transactions to detect proposer EOA
 *
 * The proposer periodically submits L2 output roots to L2OutputOracle.
 * We look for transactions to L2OutputOracle containing the proposeL2Output function call.
 * The function signature is: proposeL2Output(bytes32 _outputRoot, uint256 _l2BlockNumber, bytes32 _l1BlockHash, uint256 _l1BlockNumber)
 * Function selector: 0x9c6de194
 */
async function detectProposerEOA(
  l1RpcUrl: string,
  l2OutputOracleAddr: `0x${string}`,
  blockRange: number = 1000
): Promise<`0x${string}` | null> {
  const client = createPublicClient({
    transport: http(l1RpcUrl, { timeout: 15000 }),
  });

  // proposeL2Output function selector
  const PROPOSE_L2_OUTPUT_SELECTOR = '0x9c6de194';

  try {
    const latestBlock = await client.getBlockNumber();
    const startBlock = latestBlock - BigInt(blockRange);

    console.log(`[EOA Detector] Scanning L1 blocks ${startBlock} to ${latestBlock} for proposer transactions...`);

    for (let i = 0n; i < BigInt(blockRange); i++) {
      const blockNum = startBlock + i;

      try {
        const block = await client.getBlock({
          blockNumber: blockNum,
          includeTransactions: true,
        });

        if (!block.transactions) continue;

        // Look for transactions to L2OutputOracle
        for (const tx of block.transactions) {
          if (typeof tx === 'object' && tx.to) {
            if (tx.to.toLowerCase() === l2OutputOracleAddr.toLowerCase()) {
              // Check if calldata starts with proposeL2Output selector
              if (tx.input && tx.input.startsWith(PROPOSE_L2_OUTPUT_SELECTOR)) {
                console.log(
                  `[EOA Detector] Found proposer transaction at block ${blockNum}: ${tx.from}`
                );
                return tx.from as `0x${string}`;
              }
            }
          }
        }
      } catch (err) {
        continue;
      }
    }

    console.log('[EOA Detector] No proposer transactions found in range');
    return null;
  } catch (error) {
    console.error('[EOA Detector] Failed to detect proposer EOA:', error instanceof Error ? error.message : error);
    return null;
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Attempt to detect batcher/proposer EOAs from L1 transaction analysis
 *
 * Priority:
 * 1. Manual environment variables (BATCHER_EOA_ADDRESS, PROPOSER_EOA_ADDRESS)
 * 2. L1 transaction analysis (L1OutputOracle, BatcherInbox)
 * 3. Not detected (requires manual setup)
 */
export async function detectOrUseManualEOA(
  l1RpcUrl?: string,
  networkKey?: string
): Promise<DetectionResult> {
  // ============ Step 1: Check manual environment variables ============
  const envBatcher = process.env.BATCHER_EOA_ADDRESS;
  const envProposer = process.env.PROPOSER_EOA_ADDRESS;

  if (envBatcher && envProposer && isAddress(envBatcher) && isAddress(envProposer)) {
    return {
      batcherEOA: getAddress(envBatcher) as `0x${string}`,
      proposerEOA: getAddress(envProposer) as `0x${string}`,
      source: 'manual-env',
      confidence: 'high',
      message: 'EOAs loaded from manual environment variables',
    };
  }

  if (envBatcher || envProposer) {
    console.warn('[EOA Detector] Partial manual EOA config. Expected both BATCHER_EOA_ADDRESS and PROPOSER_EOA_ADDRESS');
  }

  // ============ Step 2: L1 Transaction Analysis ============
  const rpcUrl = l1RpcUrl || getActiveL1RpcUrl();

  if (!rpcUrl) {
    return {
      source: 'not-detected',
      confidence: 'low',
      message: 'No L1_RPC_URL configured for auto-detection',
    };
  }

  console.log('[EOA Detector] Attempting auto-detection from L1 transactions...');

  try {
    // Get contract addresses for the network
    const addresses = await getOptimismAddresses(rpcUrl, networkKey);
    if (!addresses) {
      return {
        source: 'not-detected',
        confidence: 'low',
        message: 'Could not determine Optimism contract addresses',
      };
    }

    console.log(`[EOA Detector] Using ${addresses.chainName} addresses`);
    console.log(`  BatcherInbox: ${addresses.batcherInbox}`);
    console.log(`  L2OutputOracle: ${addresses.l2OutputOracle}`);

    // Scan for batcher and proposer transactions in parallel
    const [batcherEOA, proposerEOA] = await Promise.all([
      detectBatcherEOA(rpcUrl, addresses.batcherInbox),
      detectProposerEOA(rpcUrl, addresses.l2OutputOracle),
    ]);

    const latestBlock = await createPublicClient({
      transport: http(rpcUrl, { timeout: 5000 }),
    }).getBlockNumber();

    // Determine confidence based on what we found
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (batcherEOA && proposerEOA) {
      confidence = 'high';
    } else if (batcherEOA || proposerEOA) {
      confidence = 'medium';
    }

    if (batcherEOA || proposerEOA) {
      console.log(`[EOA Detector] ✅ Auto-detection successful (confidence: ${confidence})`);
      if (batcherEOA) console.log(`  Batcher EOA: ${batcherEOA}`);
      if (proposerEOA) console.log(`  Proposer EOA: ${proposerEOA}`);

      return {
        batcherEOA,
        proposerEOA,
        source: 'l1-transaction-analysis',
        confidence,
        chainName: addresses.chainName,
        lastBlockAnalyzed: latestBlock,
      };
    } else {
      return {
        source: 'not-detected',
        confidence: 'low',
        chainName: addresses.chainName,
        lastBlockAnalyzed: latestBlock,
        message: 'No batcher/proposer transactions detected in recent blocks. Check if sequencer is running.',
      };
    }
  } catch (error) {
    console.error('[EOA Detector] Auto-detection failed:', error instanceof Error ? error.message : error);
    return {
      source: 'not-detected',
      confidence: 'low',
      message: error instanceof Error ? error.message : 'Unknown error during auto-detection',
    };
  }
}

/**
 * Get EOA address with fallback to auto-detection
 * Used by eoa-balance-monitor.ts
 */
export async function getEOAAddressWithAutoDetect(
  role: EOARole,
  l1RpcUrl?: string
): Promise<`0x${string}` | null> {
  // First try environment variable
  const envKey = role === 'batcher' ? 'BATCHER_EOA_ADDRESS' : 'PROPOSER_EOA_ADDRESS';
  const envAddr = process.env[envKey];

  if (envAddr && isAddress(envAddr)) {
    return getAddress(envAddr) as `0x${string}`;
  }

  // Then try auto-detection
  try {
    const detected = await detectOrUseManualEOA(l1RpcUrl);

    if (detected.source === 'manual-env') {
      return role === 'batcher' ? detected.batcherEOA || null : detected.proposerEOA || null;
    }

    if (detected.source === 'l1-transaction-analysis') {
      const eoa = role === 'batcher' ? detected.batcherEOA : detected.proposerEOA;
      if (eoa) {
        console.log(`[EOA Detector] Using auto-detected ${role} EOA: ${eoa}`);
        return eoa;
      }
    }

    if (detected.confidence === 'low') {
      console.warn(`[EOA Detector] Could not detect ${role} EOA. Set ${envKey} manually.`);
    }
  } catch (err) {
    console.error(`[EOA Detector] Auto-detection for ${role} failed:`, err instanceof Error ? err.message : err);
  }

  return null;
}
