/**
 * On-chain Reviews API
 * Reads ReviewSubmitted events from SentinAIReviewRegistry on Sepolia.
 * Also merges with legacy file-based reviews for backward compatibility.
 */

import { createPublicClient, http, parseAbiItem, decodeAbiParameters } from 'viem';
import { sepolia } from 'viem/chains';
import legacyReviews from '@/../data/reviews.json';

export const dynamic = 'force-dynamic';

const REVIEW_REGISTRY = '0xe63FCdbDAb179F25220361eeAe5fCf60B9151340' as const;
// ReviewRegistry deployed at this block (approximate)
const DEPLOY_BLOCK = BigInt('0xa07800');

interface OnChainReview {
  id: string;
  reviewer: string;
  operator: string;
  settlementNonce: string;
  dataAccuracy: number;
  responseSpeed: number;
  uptime: number;
  valueForMoney: number;
  comment: string;
  blockNumber: number;
  txHash: string;
  createdAt: string;
  source: 'onchain' | 'legacy';
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const operatorFilter = searchParams.get('operator')?.toLowerCase();

  const onchainReviews = await fetchOnChainReviews();
  const legacy = (legacyReviews as any[]).map(r => ({
    ...r,
    source: 'legacy' as const,
  }));

  // Merge: on-chain first, then legacy (deduplicate by txHash if exists)
  const onchainTxHashes = new Set(onchainReviews.map(r => r.txHash.toLowerCase()));
  const dedupedLegacy = legacy.filter(r => !onchainTxHashes.has(r.txHash?.toLowerCase?.() ?? ''));

  let allReviews: OnChainReview[] = [...onchainReviews, ...dedupedLegacy];

  if (operatorFilter) {
    allReviews = allReviews.filter(r =>
      (r.operator ?? (r as any).operatorAddress)?.toLowerCase() === operatorFilter
    );
  }

  // Sort by newest first
  allReviews.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return Response.json(allReviews, {
    headers: { 'Cache-Control': 'public, s-maxage=30' },
  });
}

async function fetchOnChainReviews(): Promise<OnChainReview[]> {
  const rpcUrl = process.env.SEPOLIA_RPC_URL?.trim() || 'https://ethereum-sepolia-rpc.publicnode.com';

  try {
    const client = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl, { timeout: 15_000 }),
    });

    const EVENT = parseAbiItem(
      'event ReviewSubmitted(address indexed reviewer, address indexed operator, bytes32 indexed settlementNonce, uint8 dataAccuracy, uint8 responseSpeed, uint8 uptime, uint8 valueForMoney, string comment)'
    );

    const latestBlock = await client.getBlockNumber();
    const MAX_RANGE = BigInt(49000);
    const reviews: OnChainReview[] = [];

    for (let from = DEPLOY_BLOCK; from <= latestBlock; from += MAX_RANGE) {
      const to = from + MAX_RANGE - BigInt(1) > latestBlock ? latestBlock : from + MAX_RANGE - BigInt(1);
      const logs = await client.getLogs({
        address: REVIEW_REGISTRY,
        event: EVENT,
        fromBlock: from,
        toBlock: to,
      });

      for (const log of logs) {
        const args = log.args as {
          reviewer?: string;
          operator?: string;
          settlementNonce?: string;
          dataAccuracy?: number;
          responseSpeed?: number;
          uptime?: number;
          valueForMoney?: number;
          comment?: string;
        };

        if (!args.reviewer || !args.operator) continue;

        reviews.push({
          id: `onchain-${log.transactionHash}-${log.logIndex}`,
          reviewer: args.reviewer,
          operator: args.operator,
          settlementNonce: args.settlementNonce ?? '',
          dataAccuracy: args.dataAccuracy ?? 0,
          responseSpeed: args.responseSpeed ?? 0,
          uptime: args.uptime ?? 0,
          valueForMoney: args.valueForMoney ?? 0,
          comment: args.comment ?? '',
          blockNumber: Number(log.blockNumber),
          txHash: log.transactionHash,
          createdAt: new Date().toISOString(), // Will be approximate
          source: 'onchain',
        });
      }
    }

    return reviews;
  } catch (err) {
    console.error('[reviews-onchain] RPC scan failed:', err);
    return [];
  }
}
