/**
 * EOA Balance API
 * GET: Return current balance status for batcher/proposer EOAs
 * POST: Trigger manual refill for a specific EOA
 */

import { NextResponse } from 'next/server';
import { getAllBalanceStatus, refillEOA, getRefillEvents } from '@/lib/eoa-balance-monitor';
import { getActiveL1RpcUrl } from '@/lib/l1-rpc-failover';
import type { EOARole } from '@/types/eoa-balance';

export const dynamic = 'force-dynamic';

/**
 * GET /api/eoa-balance
 * Returns balance status for all monitored EOAs
 */
export async function GET() {
  try {
    const status = await getAllBalanceStatus();
    const events = getRefillEvents();

    return NextResponse.json({
      ...status,
      recentRefills: events.slice(-10),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to fetch EOA balances: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/eoa-balance
 * Trigger manual refill: { target: 'batcher' | 'proposer' }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const target = body.target as EOARole;

    if (!target || !['batcher', 'proposer'].includes(target)) {
      return NextResponse.json(
        { error: 'Invalid target. Must be "batcher" or "proposer".' },
        { status: 400 }
      );
    }

    const targetAddr = target === 'batcher'
      ? process.env.BATCHER_EOA_ADDRESS
      : process.env.PROPOSER_EOA_ADDRESS;

    if (!targetAddr) {
      return NextResponse.json(
        { error: `${target} EOA address not configured` },
        { status: 400 }
      );
    }

    const l1RpcUrl = getActiveL1RpcUrl();
    const result = await refillEOA(l1RpcUrl, targetAddr as `0x${string}`, target);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Refill failed: ${message}` },
      { status: 500 }
    );
  }
}
