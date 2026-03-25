/**
 * Settlement Relayer
 * Server-side relayer that calls Facilitator.settle() on behalf of the buyer.
 * The buyer only signs an EIP-712 authorization; the server submits the on-chain tx.
 */

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import type { AgentMarketplacePaymentEnvelope } from './payment-verifier';
import logger from '@/lib/logger';

const FACILITATOR_ABI = parseAbi([
  'function settle(address buyer, address merchant, address asset, uint256 amount, string resource, bytes32 nonce, uint256 validAfter, uint256 validBefore, bytes signature) external returns (bool)',
  'function usedNonces(bytes32) external view returns (bool)',
]);

export interface SettlementResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

function getRpcUrl(): string {
  return process.env.SEPOLIA_RPC_URL?.trim() || 'https://ethereum-sepolia-rpc.publicnode.com';
}

function getFacilitatorAddress(): `0x${string}` {
  const addr = process.env.FACILITATOR_ADDRESS?.trim();
  if (!addr) throw new Error('FACILITATOR_ADDRESS not configured');
  return addr as `0x${string}`;
}

function getRelayerKey(): `0x${string}` {
  const key = process.env.RELAYER_PRIVATE_KEY?.trim();
  if (!key) throw new Error('RELAYER_PRIVATE_KEY not configured');
  return key as `0x${string}`;
}

/**
 * Check if a nonce has already been used on-chain.
 */
export async function isNonceUsed(nonce: `0x${string}`): Promise<boolean> {
  try {
    const client = createPublicClient({
      chain: sepolia,
      transport: http(getRpcUrl()),
    });

    return await client.readContract({
      address: getFacilitatorAddress(),
      abi: FACILITATOR_ABI,
      functionName: 'usedNonces',
      args: [nonce],
    }) as boolean;
  } catch {
    return false;
  }
}

/**
 * Submit Facilitator.settle() transaction on-chain.
 * Called by the server after EIP-712 signature verification passes.
 */
export async function settleOnChain(
  envelope: AgentMarketplacePaymentEnvelope
): Promise<SettlementResult> {
  try {
    const facilitatorAddress = getFacilitatorAddress();
    const relayerAccount = privateKeyToAccount(getRelayerKey());

    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: sepolia,
      transport: http(getRpcUrl()),
    });

    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(getRpcUrl()),
    });

    // Check nonce not already used
    const nonce = envelope.nonce as `0x${string}`;
    const used = await isNonceUsed(nonce);
    if (used) {
      return { success: false, error: 'Nonce already used (replay attempt)' };
    }

    // Submit settle tx
    const txHash = await walletClient.writeContract({
      address: facilitatorAddress,
      abi: FACILITATOR_ABI,
      functionName: 'settle',
      args: [
        envelope.buyer as `0x${string}`,
        envelope.merchant as `0x${string}`,
        envelope.asset as `0x${string}`,
        BigInt(envelope.amount),
        envelope.resource ?? '',
        nonce,
        BigInt(envelope.validAfter ?? '0'),
        BigInt(envelope.validBefore ?? '0'),
        envelope.signature as `0x${string}`,
      ],
    });

    logger.info(`[settlement-relayer] settle tx submitted: ${txHash}`);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 60_000,
    });

    if (receipt.status === 'reverted') {
      logger.error(`[settlement-relayer] settle tx reverted: ${txHash}`);
      return { success: false, txHash, error: 'Settlement transaction reverted' };
    }

    logger.info(`[settlement-relayer] settle confirmed in block ${receipt.blockNumber}: ${txHash}`);
    return { success: true, txHash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown settlement error';
    logger.error(`[settlement-relayer] settle failed: ${msg}`);
    return { success: false, error: msg };
  }
}
