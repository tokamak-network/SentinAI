/**
 * Ops Data Registry
 *
 * Registers the SentinAI ops-snapshot endpoint URI to the Sepolia ERC8004
 * on-chain registry. Re-uses the same contract and ABI as the agent
 * marketplace identity registration, but publishes an ops-snapshot URI
 * instead of the agent.json manifest URI.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';
import {
  agentMarketplaceRegistryAbi,
} from '@/lib/agent-marketplace/abi/agent-registry';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RegisterOpsDataInput {
  /** Public base URL of this SentinAI instance (e.g. https://sentinai.example.com) */
  agentUriBase: string;
  /** Hex-encoded private key for signing the registration tx */
  walletKey: string;
  /** ERC8004 registry contract address */
  registryAddress: `0x${string}` | string;
}

export type RegisterOpsDataResult =
  | {
      ok: true;
      agentId: string;
      opsUri: string;
      txHash: `0x${string}` | string;
      registeredAt: string | null;
    }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function normalizeOpsUri(agentUriBase: string): string {
  return `${agentUriBase.replace(/\/+$/, '')}/api/agent-marketplace/ops-snapshot.json`;
}

function resolveL1RpcUrl(): string | undefined {
  return (
    process.env.SENTINAI_L1_RPC_URL?.trim() ||
    process.env.L1_RPC_URL?.trim() ||
    undefined
  );
}

function resolveRegistryChain() {
  if (process.env.X402_NETWORK?.trim() === 'eip155:1') return mainnet;
  return sepolia;
}

function extractAgentId(logs: unknown[]): string | undefined {
  const agentRegisteredLogs = parseEventLogs({
    abi: agentMarketplaceRegistryAbi,
    logs: logs as Parameters<typeof parseEventLogs>[0]['logs'],
    eventName: 'AgentRegistered',
    strict: false,
  });
  const parsedAgentId = agentRegisteredLogs[0]?.args?.agentId;
  if (parsedAgentId !== undefined) return String(parsedAgentId);

  const registerLogs = parseEventLogs({
    abi: agentMarketplaceRegistryAbi,
    logs: logs as Parameters<typeof parseEventLogs>[0]['logs'],
    eventName: 'Register',
    strict: false,
  });
  const addr = registerLogs[0]?.args?.agent;
  return typeof addr === 'string' ? addr : undefined;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Register the ops-snapshot.json endpoint URI to the ERC8004 on-chain registry.
 */
export async function registerOpsData(
  input: RegisterOpsDataInput,
): Promise<RegisterOpsDataResult> {
  if (!input.agentUriBase || !input.walletKey || !input.registryAddress) {
    return { ok: false, error: 'Missing ops registration configuration (agentUriBase, walletKey, or registryAddress)' };
  }

  const l1RpcUrl = resolveL1RpcUrl();
  if (!l1RpcUrl) {
    return { ok: false, error: 'L1 RPC URL is required for ops data registration' };
  }

  const opsUri = normalizeOpsUri(input.agentUriBase);

  try {
    const chain = resolveRegistryChain();
    const account = privateKeyToAccount(input.walletKey as `0x${string}`);
    const transport = http(l1RpcUrl, { timeout: 15_000 });

    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });

    const txHash = await walletClient.writeContract({
      address: input.registryAddress as `0x${string}`,
      abi: agentMarketplaceRegistryAbi,
      functionName: 'register',
      args: [opsUri],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      return { ok: false, error: `Ops registration tx reverted (status: ${receipt.status})` };
    }

    const agentId = extractAgentId(receipt.logs);

    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
    const registeredAt = block
      ? new Date(Number(block.timestamp) * 1000).toISOString()
      : null;

    return {
      ok: true,
      agentId: agentId ?? txHash,
      opsUri,
      txHash,
      registeredAt,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
