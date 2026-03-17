/**
 * Admin Settlements API (GET)
 * - GET: List all x402 settlement records with optional filtering
 * - Requires: sentinai_admin_session cookie (validated in middleware)
 */

import { NextRequest, NextResponse } from 'next/server';
import { listAllSettlements } from '@/lib/marketplace/facilitator/settlement-store';
import type { SettlementStatus } from '@/lib/marketplace/facilitator/types';
import logger from '@/lib/logger';

const VALID_STATUSES: SettlementStatus[] = ['submitted', 'settled', 'failed'];
const SUPPORTED_CHAIN_ID = 11155111; // Sepolia

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const chainIdStr = searchParams.get('chainId') ?? String(SUPPORTED_CHAIN_ID);
    const statusParam = searchParams.get('status');
    const limitStr = searchParams.get('limit') ?? '100';

    const chainId = parseInt(chainIdStr, 10);
    if (isNaN(chainId) || chainId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid chainId' }, { status: 400 });
    }

    const limit = parseInt(limitStr, 10);
    if (isNaN(limit) || limit < 1 || limit > 500) {
      return NextResponse.json({ success: false, error: 'limit must be between 1 and 500' }, { status: 400 });
    }

    const status =
      statusParam && VALID_STATUSES.includes(statusParam as SettlementStatus)
        ? (statusParam as SettlementStatus)
        : undefined;

    const redisPrefix = process.env.TON_FACILITATOR_REDIS_PREFIX;
    if (!redisPrefix) {
      return NextResponse.json(
        { success: false, error: 'Facilitator not configured' },
        { status: 503 }
      );
    }

    const settlements = await listAllSettlements(redisPrefix, chainId, { limit, status });

    const summary = {
      total: settlements.length,
      submitted: settlements.filter((s) => s.status === 'submitted').length,
      settled: settlements.filter((s) => s.status === 'settled').length,
      failed: settlements.filter((s) => s.status === 'failed').length,
    };

    return NextResponse.json({ success: true, settlements, summary }, { status: 200 });
  } catch (error) {
    logger.error('[Settlements API] Failed:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ success: false, error: 'Failed to fetch settlements' }, { status: 500 });
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
