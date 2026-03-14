import { NextRequest, NextResponse } from 'next/server';
import { getSequencerHealth, verifyPaymentHeader } from '@/lib/agent-marketplace';

/**
 * GET /api/agent-marketplace/sequencer-health
 * Returns sequencer health metrics
 * Requires x-payment header (paid endpoint)
 * Returns 402 Payment Required without valid payment
 */
export async function GET(request: NextRequest) {
  try {
    const paymentHeader = request.headers.get('x-payment') ?? undefined;

    if (!verifyPaymentHeader(paymentHeader)) {
      return NextResponse.json(
        {
          error: 'Payment Required',
          message: 'This endpoint requires a valid payment header',
        },
        { status: 402 }
      );
    }

    const health = getSequencerHealth();
    return NextResponse.json(health, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60', // 1 minute cache
      },
    });
  } catch (error) {
    console.error('[Marketplace API] Sequencer health error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sequencer health' },
      { status: 500 }
    );
  }
}

export async function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-payment',
    },
  });
}
