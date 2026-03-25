/**
 * Operators Discovery API
 * Reads registered operators from on-chain SentinAIERC8004Registry events.
 * Falls back to hardcoded list when RPC is unavailable.
 */

import { createPublicClient, http, parseAbiItem } from 'viem';
import { sepolia } from 'viem/chains';

export const dynamic = 'force-dynamic';

const REGISTRY_ADDRESS = '0x64c8f8cB66657349190c7AF783f8E0254dCF1467' as const;
// Registry deployment block on Sepolia — start scanning from here
const REGISTRY_DEPLOY_BLOCK = BigInt('0x9f4671');

interface DiscoveredOperator {
  agentId: number;
  address: string;
  agentURI: string;
  registeredAt?: string;
}

const FALLBACK_OPERATORS: DiscoveredOperator[] = [
  { agentId: 1, address: '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9', agentURI: 'https://sentinai.tokamak.network/thanos-sepolia' },
];

export async function GET(): Promise<Response> {
  const rpcUrl = process.env.SEPOLIA_RPC_URL?.trim() || 'https://ethereum-sepolia-rpc.publicnode.com';

  try {
    const client = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl, { timeout: 15_000 }),
    });

    // Public RPCs limit block range (typically 50k blocks).
    // Scan in chunks from deploy block to latest.
    const EVENT = parseAbiItem(
      'event AgentRegistered(uint256 indexed agentId, address indexed agent, string agentURI)'
    );

    const latestBlock = await client.getBlockNumber();
    const MAX_RANGE = BigInt(49000);
    const byAddress = new Map<string, DiscoveredOperator>();

    for (let from = REGISTRY_DEPLOY_BLOCK; from <= latestBlock; from += MAX_RANGE) {
      const to = from + MAX_RANGE - BigInt(1) > latestBlock ? latestBlock : from + MAX_RANGE - BigInt(1);
      const chunk = await client.getLogs({
        address: REGISTRY_ADDRESS,
        event: EVENT,
        fromBlock: from,
        toBlock: to,
      });
      for (const log of chunk) {
        const args = log.args as { agentId?: bigint; agent?: string; agentURI?: string };
        if (!args.agent) continue;
        const addr = args.agent.toLowerCase();
        byAddress.set(addr, {
          agentId: Number(args.agentId ?? 0),
          address: addr,
          agentURI: args.agentURI ?? '',
        });
      }
    }

    const operators = Array.from(byAddress.values());

    return Response.json({
      ok: true,
      source: 'on-chain',
      registry: REGISTRY_ADDRESS,
      operators,
      count: operators.length,
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=60' },
    });
  } catch (err) {
    console.error('[operators-discovery] RPC failed:', err);
    return Response.json({
      ok: false,
      source: 'fallback',
      operators: FALLBACK_OPERATORS,
      count: FALLBACK_OPERATORS.length,
    });
  }
}
