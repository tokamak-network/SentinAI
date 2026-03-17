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

export interface RegisterAgentMarketplaceIdentityInput {
  agentUriBase: string;
  walletKey: string;
  registryAddress: `0x${string}` | string;
}

export type RegisterAgentMarketplaceIdentityResult =
  | { ok: true; agentId: string; txHash: `0x${string}` | string; registeredAt: string | null }
  | { ok: false; error: string };

function normalizeAgentUri(agentUriBase: string): string {
  return `${agentUriBase.replace(/\/+$/, '')}/api/agent-marketplace/agent.json`;
}

function resolveL1RpcUrl(): string | undefined {
  return process.env.SENTINAI_L1_RPC_URL?.trim()
    || process.env.L1_RPC_URL?.trim()
    || undefined;
}

function resolveRegistryChain() {
  const network = process.env.X402_NETWORK?.trim();
  if (network === 'eip155:1') {
    return mainnet;
  }
  return sepolia;
}

function extractRegisteredAgentId(logs: unknown[]): string | undefined {
  const agentRegisteredLogs = parseEventLogs({
    abi: agentMarketplaceRegistryAbi,
    logs: logs as Parameters<typeof parseEventLogs>[0]['logs'],
    eventName: 'AgentRegistered',
    strict: false,
  });
  const parsedAgentId = agentRegisteredLogs[0]?.args?.agentId;
  if (parsedAgentId !== undefined) {
    return String(parsedAgentId);
  }

  const registerLogs = parseEventLogs({
    abi: agentMarketplaceRegistryAbi,
    logs: logs as Parameters<typeof parseEventLogs>[0]['logs'],
    eventName: 'Register',
    strict: false,
  });
  const parsedAgentAddress = registerLogs[0]?.args?.agent;
  return typeof parsedAgentAddress === 'string' ? parsedAgentAddress : undefined;
}

export async function registerAgentMarketplaceIdentity(
  input: RegisterAgentMarketplaceIdentityInput
): Promise<RegisterAgentMarketplaceIdentityResult> {
  if (!input.agentUriBase || !input.walletKey || !input.registryAddress) {
    return {
      ok: false,
      error: 'Missing marketplace registration configuration',
    };
  }

  const l1RpcUrl = resolveL1RpcUrl();
  if (!l1RpcUrl) {
    return {
      ok: false,
      error: 'L1 RPC is required for marketplace registration',
    };
  }

  try {
    const chain = resolveRegistryChain();
    const account = privateKeyToAccount(input.walletKey as `0x${string}`);
    const transport = http(l1RpcUrl, { timeout: 15_000 });
    const publicClient = createPublicClient({
      chain,
      transport,
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport,
    });

    const txHash = await walletClient.writeContract({
      address: input.registryAddress as `0x${string}`,
      abi: agentMarketplaceRegistryAbi,
      functionName: 'register',
      args: [normalizeAgentUri(input.agentUriBase)],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      return {
        ok: false,
        error: `Marketplace registration receipt status was ${receipt.status}`,
      };
    }

    const parsedAgentId = extractRegisteredAgentId(receipt.logs);

    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
    const registeredAt = block
      ? new Date(Number(block.timestamp) * 1000).toISOString()
      : null;

    return {
      ok: true,
      agentId: parsedAgentId !== undefined ? String(parsedAgentId) : txHash,
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
