import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';
import {
  agentMarketplaceReputationRegistryAbi,
} from '@/lib/agent-marketplace/abi/reputation-registry';

export type ReputationSubmitResult =
  | { ok: true; txHash: `0x${string}` | string; batchHash?: string; merkleRoot?: `0x${string}` | string }
  | { ok: false; error: string };

function resolveL1RpcUrl(): string | undefined {
  return process.env.SENTINAI_L1_RPC_URL?.trim()
    || process.env.L1_RPC_URL?.trim()
    || undefined;
}

function resolveChain() {
  return process.env.X402_NETWORK?.trim() === 'eip155:1' ? mainnet : sepolia;
}

function extractSubmittedRootEvent(logs: unknown[]): {
  batchHash?: string;
  merkleRoot?: `0x${string}` | string;
} {
  const merkleRootLogs = parseEventLogs({
    abi: agentMarketplaceReputationRegistryAbi,
    logs: logs as Parameters<typeof parseEventLogs>[0]['logs'],
    eventName: 'MerkleRootSubmitted',
    strict: false,
  });
  const primaryLog = merkleRootLogs[0];
  if (primaryLog) {
    return {
      batchHash: typeof primaryLog.args?.batchHash === 'string' ? primaryLog.args.batchHash : undefined,
      merkleRoot: primaryLog.args?.merkleRoot as `0x${string}` | undefined,
    };
  }

  const rootSubmittedLogs = parseEventLogs({
    abi: agentMarketplaceReputationRegistryAbi,
    logs: logs as Parameters<typeof parseEventLogs>[0]['logs'],
    eventName: 'RootSubmitted',
    strict: false,
  });
  const fallbackLog = rootSubmittedLogs[0];

  return {
    batchHash: typeof fallbackLog?.args?.batchHash === 'string' ? fallbackLog.args.batchHash : undefined,
    merkleRoot: fallbackLog?.args?.root as `0x${string}` | undefined,
  };
}

export async function submitAgentMarketplaceReputationRoot(input: {
  walletKey: `0x${string}` | string;
  registryAddress: `0x${string}` | string;
  batchHash: string;
  root: `0x${string}` | string;
  agents: Array<{ agentId: `0x${string}` | string; score: number }>;
}): Promise<ReputationSubmitResult> {
  const l1RpcUrl = resolveL1RpcUrl();
  if (!l1RpcUrl) {
    return {
      ok: false,
      error: 'L1 RPC is required for reputation submission',
    };
  }

  try {
    const chain = resolveChain();
    const account = privateKeyToAccount(input.walletKey as `0x${string}`);
    const transport = http(l1RpcUrl, { timeout: 15_000 });
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });

    const txHash = await walletClient.writeContract({
      address: input.registryAddress as `0x${string}`,
      abi: agentMarketplaceReputationRegistryAbi,
      functionName: 'submitMerkleRoot',
      args: [
        input.agents.map((agent) => agent.agentId as `0x${string}`),
        input.agents.map((agent) => agent.score),
        input.root as `0x${string}`,
        input.batchHash,
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      return {
        ok: false,
        error: `Reputation submission receipt status was ${receipt.status}`,
      };
    }

    const parsedLog = extractSubmittedRootEvent(receipt.logs);

    return {
      ok: true,
      txHash,
      batchHash: parsedLog.batchHash ?? input.batchHash,
      merkleRoot: parsedLog.merkleRoot ?? input.root,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
