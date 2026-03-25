/**
 * Operators Discovery API
 * Reads registered operators from on-chain SentinAIERC8004Registry events.
 * Falls back to hardcoded list when RPC is unavailable.
 */

import { createPublicClient, http, parseAbiItem } from 'viem';
import { sepolia } from 'viem/chains';

export const dynamic = 'force-dynamic';

const REGISTRY_ADDRESS = '0x64c8f8cB66657349190c7AF783f8E0254dCF1467' as const;

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

    const logs = await client.getLogs({
      address: REGISTRY_ADDRESS,
      event: parseAbiItem(
        'event AgentRegistered(uint256 indexed agentId, address indexed agent, string agentURI)'
      ),
      fromBlock: BigInt(0),
      toBlock: 'latest',
    });

    // Deduplicate by address (keep latest registration)
    const byAddress = new Map<string, DiscoveredOperator>();
    for (const log of logs) {
      const addr = (log.args.agent as string).toLowerCase();
      byAddress.set(addr, {
        agentId: Number(log.args.agentId),
        address: addr,
        agentURI: log.args.agentURI as string,
      });
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
